import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/d1";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { outbox, wardrobeItems } from "../../src/db/schema-core";
import { env } from "../../src/env";
import { photoKeyFor } from "../../src/lib/garment-photo-key";
import { newUlid } from "../../src/lib/ids";
import { nowSeconds } from "../../src/lib/now";
import type { OutboxMessage } from "../../src/lib/outbox";
import { createItem } from "../../src/modules/closet";
import { handleScheduled } from "../../src/modules/ops";
import {
  backoffSeconds,
  checkOutboxBacklog,
  drainOutbox,
  OUTBOX_DRAIN_CAP,
  OUTBOX_FAST_PATH_GRACE_S,
  OUTBOX_TERMINAL_ATTEMPTS,
  outboxInsert,
  oweOutbox,
  settleOutbox,
} from "../../src/modules/ops/outbox";
import {
  isLiveObject,
  outboxHandlers,
  reconcileItemPhotos,
  type OutboxHandlers,
} from "../../src/modules/ops/outbox-handlers";

const DIGEST = { cron: "0 12 * * *" } as ScheduledController;
const NOW = 1_800_000_000;

function db() {
  return drizzle(env.DIALED_CORE);
}

function photoDelete(
  userId: string = newUlid(),
  itemId: string = newUlid(),
): OutboxMessage {
  return { kind: "photo_delete", payload: { userId, itemId } };
}

/**
A row as a past fast path left it: due at `nextAttemptAt`.
*/
async function owedRow(
  overrides: Partial<typeof outbox.$inferInsert> = {},
): Promise<string> {
  const id = newUlid();
  const message = photoDelete();
  await db()
    .insert(outbox)
    .values({
      id,
      kind: message.kind,
      dedupeKey: `${message.payload.userId}:${message.payload.itemId}`,
      payload: JSON.stringify(message.payload),
      nextAttemptAt: NOW,
      createdAt: NOW - 3600,
      ...overrides,
    });
  return id;
}

async function rowById(id: string) {
  const [row] = await db().select().from(outbox).where(eq(outbox.id, id));
  return row;
}

/**
Handlers whose `run` is the given mock, with the real context.
*/
function handlersRunning(run: OutboxHandlers["photo_delete"]["run"]) {
  return {
    photo_delete: { run, context: outboxHandlers.photo_delete.context },
  } satisfies OutboxHandlers;
}

function nothing(): void {
  /*
  console.error is expected on these paths; keep the output quiet
  */
}

beforeEach(async () => {
  await db().delete(outbox);
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("backoffSeconds", () => {
  it("waits an hour after the first attempt and doubles, capped at a week", () => {
    expect(backoffSeconds(1)).toBe(3600);
    expect(backoffSeconds(2)).toBe(7200);
    expect(backoffSeconds(8)).toBe(128 * 3600);
    expect(backoffSeconds(9)).toBe(7 * 24 * 3600);
    expect(backoffSeconds(30)).toBe(7 * 24 * 3600);
  });
});

describe("outboxInsert", () => {
  it("writes the debt, due once the fast path's grace has passed", async () => {
    const debt = oweOutbox(photoDelete("u1", "i1"));

    await outboxInsert(db(), debt, NOW);

    expect(await rowById(debt.id)).toStrictEqual({
      id: debt.id,
      kind: "photo_delete",
      dedupeKey: "u1:i1",
      payload: JSON.stringify({ userId: "u1", itemId: "i1" }),
      attempts: 0,
      // Fifteen minutes: past any fast path, well inside a day.
      nextAttemptAt: NOW + 15 * 60,
      createdAt: NOW,
    });
  });

  it("makes a second debt with the same key the same row, taken over by the newer writer", async () => {
    const first = oweOutbox(photoDelete("u1", "i1"));
    const second = oweOutbox(photoDelete("u1", "i1"));
    await outboxInsert(db(), first, NOW);
    await db()
      .update(outbox)
      .set({ attempts: 3, nextAttemptAt: NOW + 99_999 })
      .where(eq(outbox.id, first.id));

    await outboxInsert(db(), second, NOW + 10);

    const rows = await db().select().from(outbox);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      id: second.id,
      attempts: 3,
      nextAttemptAt: NOW + 10 + OUTBOX_FAST_PATH_GRACE_S,
      createdAt: NOW,
    });
  });
});

describe("settleOutbox (the fast path)", () => {
  it("runs the handler and deletes its row", async () => {
    const debt = oweOutbox(photoDelete());
    await outboxInsert(db(), debt);
    const run = vi.fn().mockResolvedValue(undefined);

    await settleOutbox(db(), debt, vi.fn(), handlersRunning(run));

    expect(run).toHaveBeenCalledWith(expect.anything(), debt.message.payload);
    expect(await rowById(debt.id)).toBeUndefined();
  });

  it("leaves a row another writer has taken over since", async () => {
    const debt = oweOutbox(photoDelete("u1", "i1"));
    const newer = oweOutbox(photoDelete("u1", "i1"));
    await outboxInsert(db(), debt);
    const run = vi.fn(async () => {
      await outboxInsert(db(), newer);
    });

    await settleOutbox(db(), debt, vi.fn(), handlersRunning(run));

    expect(await rowById(newer.id)).toBeDefined();
  });

  it("never throws: a failure is reported with ids and the row stays owed", async () => {
    const debt = oweOutbox(photoDelete("u1", "i1"));
    await outboxInsert(db(), debt);
    const report = vi.fn();
    const failure = new Error("R2 down");

    await settleOutbox(
      db(),
      debt,
      report,
      handlersRunning(vi.fn().mockRejectedValue(failure)),
    );

    expect(report).toHaveBeenCalledWith(failure, {
      surface: "outbox-fast-path",
      kind: "photo_delete",
      outboxId: debt.id,
      userId: "u1",
      itemId: "i1",
    });
    expect(await rowById(debt.id)).toBeDefined();
  });
});

describe("drainOutbox", () => {
  it("does nothing, and says nothing, when nothing is owed", async () => {
    const anomalies: string[] = [];
    const run = vi.fn();

    await drainOutbox(db(), anomalies, {
      now: NOW,
      handlers: handlersRunning(run),
    });

    expect(anomalies).toStrictEqual([]);
    expect(run).not.toHaveBeenCalled();
  });

  it("works a due row, deletes it, and reports that it was owed", async () => {
    const id = await owedRow({ nextAttemptAt: NOW });
    const anomalies: string[] = [];
    const run = vi.fn().mockResolvedValue(undefined);

    await drainOutbox(db(), anomalies, {
      now: NOW,
      handlers: handlersRunning(run),
    });

    expect(run).toHaveBeenCalledTimes(1);
    expect(await rowById(id)).toBeUndefined();
    expect(anomalies).toStrictEqual([
      "1 photo_delete outbox row(s) were owed; 1 settled",
    ]);
  });

  it("leaves a row that is not yet due", async () => {
    const id = await owedRow({ nextAttemptAt: NOW + 1 });
    const run = vi.fn();

    await drainOutbox(db(), [], { now: NOW, handlers: handlersRunning(run) });

    expect(run).not.toHaveBeenCalled();
    expect(await rowById(id)).toMatchObject({ attempts: 0 });
  });

  it("does not take a row its fast path may still be settling", async () => {
    const debt = oweOutbox(photoDelete());
    await outboxInsert(db(), debt, NOW);
    const run = vi.fn();

    await drainOutbox(db(), [], {
      now: NOW + OUTBOX_FAST_PATH_GRACE_S - 1,
      handlers: handlersRunning(run),
    });

    expect(run).not.toHaveBeenCalled();
  });

  it("backs off a failed row, and takes it again only once the backoff is due", async () => {
    vi.spyOn(console, "error").mockImplementation(nothing);
    const id = await owedRow({ nextAttemptAt: NOW });
    const report = vi.fn();
    const handlers = handlersRunning(
      vi.fn().mockRejectedValue(new Error("R2 down")),
    );
    const anomalies: string[] = [];

    await drainOutbox(db(), anomalies, { now: NOW, report, handlers });

    expect(anomalies).toStrictEqual([
      "1 photo_delete outbox row(s) were owed; 0 settled",
    ]);
    expect(await rowById(id)).toMatchObject({
      attempts: 1,
      nextAttemptAt: NOW + 3600,
    });

    await drainOutbox(db(), [], { now: NOW + 3599, report, handlers });
    expect(await rowById(id)).toMatchObject({ attempts: 1 });

    await drainOutbox(db(), [], { now: NOW + 3600, report, handlers });
    expect(await rowById(id)).toMatchObject({
      attempts: 2,
      nextAttemptAt: NOW + 3600 + 7200,
    });
  });

  it("reports a failure with the row's ids and the payload's, and marks the terminal one", async () => {
    const message = photoDelete("u1", "i1");
    const early = await owedRow({
      dedupeKey: "early",
      payload: JSON.stringify(message.payload),
      attempts: OUTBOX_TERMINAL_ATTEMPTS - 2,
    });
    const last = await owedRow({
      dedupeKey: "last",
      payload: JSON.stringify(message.payload),
      attempts: OUTBOX_TERMINAL_ATTEMPTS - 1,
      nextAttemptAt: NOW - 1,
    });
    const failure = new Error("R2 down");
    const report = vi.fn();

    await drainOutbox(db(), [], {
      now: NOW,
      report,
      handlers: handlersRunning(vi.fn().mockRejectedValue(failure)),
    });

    expect(report).toHaveBeenCalledWith(failure, {
      surface: "outbox-drain",
      kind: "photo_delete",
      outboxId: last,
      attempts: String(OUTBOX_TERMINAL_ATTEMPTS),
      terminal: "true",
      userId: "u1",
      itemId: "i1",
    });
    expect(report).toHaveBeenCalledWith(failure, {
      surface: "outbox-drain",
      kind: "photo_delete",
      outboxId: early,
      attempts: String(OUTBOX_TERMINAL_ATTEMPTS - 1),
      terminal: "false",
      userId: "u1",
      itemId: "i1",
    });
  });

  it("claims only what it can swap, so overlapping runs work each row once", async () => {
    const ids = [await owedRow(), await owedRow(), await owedRow()];
    const worked: string[] = [];
    const run = vi.fn(async (_db: unknown, payload: { itemId: string }) => {
      worked.push(payload.itemId);
      await new Promise((resolve) => setTimeout(resolve, 5));
    });
    const handlers = handlersRunning(run);

    await Promise.all([
      drainOutbox(db(), [], { now: NOW, handlers }),
      drainOutbox(db(), [], { now: NOW, handlers }),
    ]);

    expect(worked).toHaveLength(3);
    expect(new Set(worked).size).toBe(3);
    for (const id of ids) expect(await rowById(id)).toBeUndefined();
  });

  it("takes at most the cap per kind per run, oldest first", async () => {
    const ids: string[] = [];
    for (let index = 0; index < OUTBOX_DRAIN_CAP + 2; index += 1) {
      // Written newest first, so insertion order is not the answer.
      ids.push(await owedRow({ nextAttemptAt: NOW - index }));
    }
    const run = vi.fn().mockResolvedValue(undefined);
    const anomalies: string[] = [];

    await drainOutbox(db(), anomalies, {
      now: NOW,
      handlers: handlersRunning(run),
    });

    expect(run).toHaveBeenCalledTimes(OUTBOX_DRAIN_CAP);
    expect(anomalies).toStrictEqual([
      `${String(OUTBOX_DRAIN_CAP)} photo_delete outbox row(s) were owed; ${String(OUTBOX_DRAIN_CAP)} settled`,
    ]);
    const left = await db().select({ id: outbox.id }).from(outbox);
    expect(new Set(left.map((row) => row.id))).toStrictEqual(
      new Set(ids.slice(0, 2)),
    );
  });

  it("surfaces a row whose payload does not parse, and keeps it owed", async () => {
    const id = await owedRow({ payload: "{not json" });
    const report = vi.fn();
    const run = vi.fn();

    await drainOutbox(db(), [], {
      now: NOW,
      report,
      handlers: handlersRunning(run),
    });

    expect(run).not.toHaveBeenCalled();
    expect(report).toHaveBeenCalledWith(
      new Error("outbox row unreadable: payload is not JSON"),
      {
        surface: "outbox-drain",
        kind: "photo_delete",
        outboxId: id,
        attempts: "1",
        terminal: "false",
      },
    );
    expect(await rowById(id)).toMatchObject({ attempts: 1 });
  });

  it("never claims a kind this build does not know", async () => {
    const id = await owedRow({ kind: "from_a_newer_deploy" });

    await drainOutbox(db(), [], {
      now: NOW,
      handlers: handlersRunning(vi.fn()),
    });

    expect(await rowById(id)).toMatchObject({
      attempts: 0,
      nextAttemptAt: NOW,
    });
  });
});

describe("checkOutboxBacklog", () => {
  it("names rows past their terminal attempt, and rows no build here can drain", async () => {
    await owedRow({ attempts: OUTBOX_TERMINAL_ATTEMPTS });
    await owedRow({ attempts: OUTBOX_TERMINAL_ATTEMPTS + 3 });
    await owedRow({ attempts: OUTBOX_TERMINAL_ATTEMPTS - 1 });
    await owedRow({ kind: "from_a_newer_deploy" });
    const anomalies: string[] = [];

    await checkOutboxBacklog(db(), anomalies);

    expect(anomalies).toStrictEqual([
      `2 photo_delete outbox row(s) exhausted ${String(OUTBOX_TERMINAL_ATTEMPTS)} attempts and are still owed`,
      "1 outbox row(s) of kind from_a_newer_deploy, which this build cannot drain",
    ]);
  });

  it("says nothing about a healthy outbox", async () => {
    await owedRow({ attempts: 1 });
    const anomalies: string[] = [];

    await checkOutboxBacklog(db(), anomalies);

    expect(anomalies).toStrictEqual([]);
  });
});

describe("the daily digest drains the outbox", () => {
  it("drains a real photo debt, and reports a terminal row and an unreadable one", async () => {
    vi.spyOn(console, "error").mockImplementation(nothing);
    const userId = newUlid();
    const itemId = newUlid();
    const key = `${photoKeyFor(userId, itemId)}/01V1/card.webp`;
    await env.MEDIA.put(key, new Uint8Array([1]));
    await owedRow({
      dedupeKey: `${userId}:${itemId}`,
      payload: JSON.stringify({ userId, itemId }),
      nextAttemptAt: nowSeconds() - 1,
    });
    // Unparseable and already at its last attempt: the drain claims it,
    // cannot read it, and the backlog check then names it as terminal.
    await owedRow({
      dedupeKey: "garbled",
      payload: "{not json",
      attempts: OUTBOX_TERMINAL_ATTEMPTS - 1,
      nextAttemptAt: nowSeconds() - 1,
    });

    const outcome = await handleScheduled(DIGEST);

    expect(await env.MEDIA.head(key)).toBeNull();
    expect(outcome.anomalies).toStrictEqual([
      "2 photo_delete outbox row(s) were owed; 1 settled",
      `1 photo_delete outbox row(s) exhausted ${String(OUTBOX_TERMINAL_ATTEMPTS)} attempts and are still owed`,
    ]);
  });
});

describe("isLiveObject", () => {
  it("keeps only the named photo's own objects", () => {
    expect(isLiveObject("items/u/i/01V1/card.webp", "items/u/i/01V1")).toBe(
      true,
    );
    expect(isLiveObject("items/u/i/01V0/card.webp", "items/u/i/01V1")).toBe(
      false,
    );
    expect(isLiveObject("items/u/i/01V1X/card.webp", "items/u/i/01V1")).toBe(
      false,
    );
  });

  it("keeps a legacy unversioned photo, and not the versions beside it", () => {
    expect(isLiveObject("items/u/i/card.webp", "items/u/i")).toBe(true);
    expect(isLiveObject("items/u/i/01V1/card.webp", "items/u/i")).toBe(false);
  });

  it("keeps nothing when no photo is named, even at a key its absence spells", () => {
    expect(isLiveObject("undefined/card.webp", undefined)).toBe(false);
  });
});

async function stored(prefix: string): Promise<string[]> {
  const listed = await env.MEDIA.list({ prefix });
  return listed.objects.map((object) => object.key);
}

describe("reconcileItemPhotos", () => {
  it("clears every page of a garment that is gone, and nothing beside it", async () => {
    const userId = newUlid();
    const itemId = newUlid();
    const prefix = photoKeyFor(userId, itemId);
    const beside = `${prefix}X/card.webp`;
    for (const name of ["a", "b", "c", "d", "e"]) {
      await env.MEDIA.put(`${prefix}/01V1/${name}.webp`, new Uint8Array([1]));
    }
    await env.MEDIA.put(beside, new Uint8Array([1]));

    await reconcileItemPhotos(db(), userId, itemId, 2);

    expect(await stored(`${prefix}/`)).toStrictEqual([]);
    expect(await stored(beside)).toStrictEqual([beside]);
    await env.MEDIA.delete(beside);
  });

  it("keeps the photo the garment's row names", async () => {
    const userId = newUlid();
    const item = await createItem(db(), userId, {
      category: "top",
      name: "Reconciled",
    });
    const prefix = photoKeyFor(userId, item.id);
    const live = `${prefix}/01V2`;
    await db()
      .update(wardrobeItems)
      .set({ photoKey: live })
      .where(eq(wardrobeItems.id, item.id));
    await env.MEDIA.put(`${prefix}/01V1/card.webp`, new Uint8Array([1]));
    await env.MEDIA.put(`${live}/card.webp`, new Uint8Array([1]));

    await reconcileItemPhotos(db(), userId, item.id);

    expect(await stored(`${prefix}/`)).toStrictEqual([`${live}/card.webp`]);
  });
});
