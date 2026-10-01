import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";

import { dataExports } from "../../src/db/schema-core";
import { env } from "../../src/env";
import {
  EXPORT_EVERY_S,
  EXPORT_LINK_TTL_S,
  exportTokenSchema,
} from "../../src/lib/data-export";
import { newUlid } from "../../src/lib/ids";
import {
  canRequest,
  exportFileResponse,
  exportKeyFor,
  exportPrefixFor,
  exportRowState,
  failExport,
  newLinkToken,
  requestExport,
  rowState,
} from "../../src/modules/account/data-exports";
import { core } from "../email/helpers";

/**
 * The emailed export's rows (task 126, ACC-10) on real D1 and R2: asking
 * for one — idempotent, one in flight, one a day — what the Settings row
 * says, the DLQ's "failed", and the download the email links to.
 */

const db = core();
const NOW = 1_800_000_000;

type Status = (typeof dataExports.$inferInsert)["status"];

function effects() {
  const sent: unknown[] = [];
  const reports: { error: unknown; context: Record<string, string> }[] = [];
  return {
    sent,
    reports,
    effects: {
      queue: {
        send: (message: unknown) => {
          sent.push(message);
          return Promise.resolve();
        },
      },
      report: (error: unknown, context: Record<string, string>) => {
        reports.push({ error, context });
      },
    },
  };
}

async function seedExport(
  userId: string,
  status: Status,
  overrides: Partial<typeof dataExports.$inferInsert> = {},
) {
  const row = {
    id: newUlid(),
    userId,
    idempotencyKey: newUlid(),
    linkToken: newLinkToken(),
    status,
    requestedAt: NOW - 60,
    claimId: newUlid(),
    ...overrides,
  };
  await db.insert(dataExports).values(row);
  return row;
}

/**
The ZIP key of a seeded, claimed row.
*/
function keyOf(
  row: Readonly<{
    userId: string;
    id: string;
    claimId?: string | null | undefined;
  }>,
): string {
  if (row.claimId === undefined || row.claimId === null) {
    throw new Error("seeded without a claim");
  }
  return exportKeyFor({ userId: row.userId, id: row.id, claimId: row.claimId });
}

async function rowsOf(userId: string) {
  return db.select().from(dataExports).where(eq(dataExports.userId, userId));
}

describe("the export's link and key", () => {
  it("mints 128 random bits as hex, different every time", () => {
    const tokens = new Set(Array.from({ length: 20 }, () => newLinkToken()));
    expect(tokens.size).toBe(20);
    for (const token of tokens) {
      expect(exportTokenSchema.safeParse(token).success).toBe(true);
    }
    expect(exportTokenSchema.safeParse("0".repeat(31)).success).toBe(false);
    expect(exportTokenSchema.safeParse("G".repeat(32)).success).toBe(false);
  });

  it("stages a runner's ZIPs beside their uploads, never inside them", () => {
    expect(exportPrefixFor("u1")).toBe("exports/u1/");
  });

  it("keys each claim's ZIP apart, and a row never claimed has none", async () => {
    expect(exportKeyFor({ userId: "u1", id: "e1", claimId: "c1" })).toBe(
      "exports/u1/e1/c1.zip",
    );
    expect(exportKeyFor({ userId: "u1", id: "e1", claimId: "c2" })).toBe(
      "exports/u1/e1/c2.zip",
    );
    // As the table holds a row no build has claimed.
    const unclaimed = await rowWith("pending", { claimId: undefined });
    expect(unclaimed?.claimId).toBeNull();
    expect(unclaimed && exportKeyFor(unclaimed)).toBeUndefined();
  });
});

/**
A row as the table holds it, for `rowState`: seeded, then read back.
*/
async function rowWith(
  status: Status,
  overrides: Partial<typeof dataExports.$inferInsert> = {},
) {
  const seeded = await seedExport(newUlid(), status, overrides);
  const [row] = await db
    .select()
    .from(dataExports)
    .where(eq(dataExports.id, seeded.id));
  return row;
}

/**
A row for `canRequest` and `rowState`, asked for at `requestedAt`.
*/
function rowLike(status: Status, requestedAt: number) {
  return rowWith(status, { requestedAt });
}

describe("canRequest", () => {
  it("blocks while a build is in flight, however long it has been waiting", async () => {
    // The in-flight check must gate on its own, before the once-a-day
    // arithmetic ever runs — an old enough `pending`/`building` row would
    // otherwise clear the elapsed-time check on its own.
    expect(
      canRequest(await rowLike("pending", NOW - EXPORT_EVERY_S - 1), NOW),
    ).toBe(false);
    expect(
      canRequest(await rowLike("building", NOW - EXPORT_EVERY_S - 1), NOW),
    ).toBe(false);
  });

  it("allows one a day once nothing is in flight, never before", async () => {
    expect(canRequest(await rowLike("ready", NOW - EXPORT_EVERY_S), NOW)).toBe(
      true,
    );
    expect(
      canRequest(await rowLike("ready", NOW - EXPORT_EVERY_S + 1), NOW),
    ).toBe(false);
  });

  it("always allows another after a failure, and the very first request", async () => {
    expect(canRequest(await rowLike("failed", NOW), NOW)).toBe(true);
    expect(canRequest(undefined, NOW)).toBe(true);
  });
});

describe("rowState", () => {
  it("is idle with nothing asked for", () => {
    expect(rowState(undefined, NOW)).toStrictEqual({ state: "idle" });
  });

  it.each(["pending", "building"] as const)(
    "is preparing while %s",
    async (status) => {
      expect(rowState(await rowWith(status), NOW)).toStrictEqual({
        state: "preparing",
      });
    },
  );

  it("is failed after the DLQ gave up", async () => {
    expect(rowState(await rowWith("failed"), NOW)).toStrictEqual({
      state: "failed",
    });
  });

  it("offers the ready copy on the day it was asked for, and a new one after", async () => {
    const ready = await rowWith("ready", {
      readyAt: NOW - 30,
      expiresAt: NOW + EXPORT_LINK_TTL_S,
    });
    const requestedAt = NOW - 60;
    expect(rowState(ready, NOW)).toStrictEqual({
      state: "ready",
      token: ready?.linkToken,
      expiresAt: NOW + EXPORT_LINK_TTL_S,
    });
    expect(rowState(ready, requestedAt + EXPORT_EVERY_S - 1).state).toBe(
      "ready",
    );
    expect(rowState(ready, requestedAt + EXPORT_EVERY_S)).toStrictEqual({
      state: "idle",
    });
  });

  it("never fills in a ready state's token and expiry when there is no expiry to key it to", async () => {
    expect(rowState(await rowLike("ready", NOW), NOW)).toStrictEqual({
      state: "idle",
    });
  });

  it("is idle for a ready row with no expiry, and for one being expired", async () => {
    expect(rowState(await rowWith("ready"), NOW)).toStrictEqual({
      state: "idle",
    });
    expect(rowState(await rowWith("expiring"), NOW)).toStrictEqual({
      state: "idle",
    });
    // Even with its expiry still set and asked for today: an expiring copy
    // is on its way out, and the row never offers it.
    const expiring = await rowWith("expiring", {
      requestedAt: NOW - 60,
      expiresAt: NOW + 60,
    });
    expect(rowState(expiring, NOW)).toStrictEqual({ state: "idle" });
  });
});

describe("exportRowState", () => {
  it("reads the runner's latest export, and only theirs", async () => {
    const userId = newUlid();
    await seedExport(userId, "failed", { requestedAt: NOW - 3 * 86_400 });
    await seedExport(userId, "pending", { requestedAt: NOW - 60 });
    await seedExport(newUlid(), "failed");
    expect(await exportRowState(db, userId, NOW)).toStrictEqual({
      state: "preparing",
    });
    expect(await exportRowState(db, newUlid(), NOW)).toStrictEqual({
      state: "idle",
    });
  });
});

describe("requestExport", () => {
  it("makes one pending export with a fresh link, and queues it", async () => {
    const userId = newUlid();
    const idempotencyKey = newUlid();
    const { sent, reports, effects: live } = effects();

    expect(
      await requestExport(db, { userId, idempotencyKey }, live, NOW),
    ).toStrictEqual({ state: "preparing" });

    const [row, ...others] = await rowsOf(userId);
    expect(others).toStrictEqual([]);
    expect(row).toMatchObject({
      userId,
      idempotencyKey,
      status: "pending",
      requestedAt: NOW,
    });
    expect(row?.claimedAt).toBeNull();
    expect(exportTokenSchema.safeParse(row?.linkToken).success).toBe(true);
    expect(sent).toStrictEqual([{ type: "account_export", exportId: row?.id }]);
    expect(reports).toStrictEqual([]);
  });

  it("answers a repeat of the same press with what the first made", async () => {
    const userId = newUlid();
    const idempotencyKey = newUlid();
    const first = effects();
    await requestExport(db, { userId, idempotencyKey }, first.effects, NOW);
    const second = effects();

    expect(
      await requestExport(
        db,
        { userId, idempotencyKey },
        second.effects,
        NOW + 5,
      ),
    ).toStrictEqual({ state: "preparing" });
    expect(await rowsOf(userId)).toHaveLength(1);
    expect(second.sent).toStrictEqual([]);
  });

  it("answers a repeat of an old failed press with that press's failure, even while a newer one is in flight", async () => {
    // The repeat lookup is keyed by idempotencyKey, which is not
    // necessarily the user's latest row — a skipped repeat check would
    // fall through to the *latest* row's state instead of the one this
    // exact key made.
    const userId = newUlid();
    const oldFailed = await seedExport(userId, "failed", {
      requestedAt: NOW - 2 * EXPORT_EVERY_S,
    });
    await seedExport(userId, "pending", { requestedAt: NOW - 10 });
    const { sent, effects: live } = effects();

    expect(
      await requestExport(
        db,
        { userId, idempotencyKey: oldFailed.idempotencyKey },
        live,
        NOW,
      ),
    ).toStrictEqual({ state: "failed" });
    expect(sent).toStrictEqual([]);
    expect(await rowsOf(userId)).toHaveLength(2);
  });

  it("answers a repeat of a press whose export failed with the failure", async () => {
    const userId = newUlid();
    const failed = await seedExport(userId, "failed");
    const { sent, effects: live } = effects();
    expect(
      await requestExport(
        db,
        { userId, idempotencyKey: failed.idempotencyKey },
        live,
        NOW,
      ),
    ).toStrictEqual({ state: "failed" });
    expect(sent).toStrictEqual([]);
  });

  it("makes nothing new while one is in flight", async () => {
    const userId = newUlid();
    await seedExport(userId, "building");
    const { sent, effects: live } = effects();
    expect(
      await requestExport(db, { userId, idempotencyKey: newUlid() }, live, NOW),
    ).toStrictEqual({ state: "preparing" });
    expect(await rowsOf(userId)).toHaveLength(1);
    expect(sent).toStrictEqual([]);
  });

  it("makes one a day, counting from the last that did not fail", async () => {
    const userId = newUlid();
    const ready = await seedExport(userId, "ready", {
      requestedAt: NOW - EXPORT_EVERY_S + 1,
      readyAt: NOW - EXPORT_EVERY_S + 60,
      expiresAt: NOW + EXPORT_LINK_TTL_S,
    });
    const today = effects();
    expect(
      await requestExport(
        db,
        { userId, idempotencyKey: newUlid() },
        today.effects,
        NOW,
      ),
    ).toStrictEqual({
      state: "ready",
      token: ready.linkToken,
      expiresAt: NOW + EXPORT_LINK_TTL_S,
    });
    expect(today.sent).toStrictEqual([]);

    const tomorrow = effects();
    expect(
      await requestExport(
        db,
        { userId, idempotencyKey: newUlid() },
        tomorrow.effects,
        NOW + 1,
      ),
    ).toStrictEqual({ state: "preparing" });
    expect(await rowsOf(userId)).toHaveLength(2);
    expect(tomorrow.sent).toHaveLength(1);
  });

  it("tries again at once after a failure", async () => {
    const userId = newUlid();
    await seedExport(userId, "failed", { requestedAt: NOW - 10 });
    const { sent, effects: live } = effects();
    expect(
      await requestExport(db, { userId, idempotencyKey: newUlid() }, live, NOW),
    ).toStrictEqual({ state: "preparing" });
    expect(sent).toHaveLength(1);
  });

  it("lets the table settle two presses that raced past the reads", async () => {
    const userId = newUlid();
    const { sent, effects: live } = effects();
    const answers = await Promise.all([
      requestExport(db, { userId, idempotencyKey: newUlid() }, live, NOW),
      requestExport(db, { userId, idempotencyKey: newUlid() }, live, NOW),
    ]);
    expect(answers).toStrictEqual([
      { state: "preparing" },
      { state: "preparing" },
    ]);
    expect(await rowsOf(userId)).toHaveLength(1);
    expect(sent).toHaveLength(1);
  });

  it("keeps the export when the queue send fails, and reports it for the sweep to re-send", async () => {
    const userId = newUlid();
    const reports: { error: unknown; context: Record<string, string> }[] = [];
    const failure = new Error("queue down");
    const answer = await requestExport(
      db,
      { userId, idempotencyKey: newUlid() },
      {
        queue: { send: () => Promise.reject(failure) },
        report: (error, context) => {
          reports.push({ error, context });
        },
      },
      NOW,
    );
    expect(answer).toStrictEqual({ state: "preparing" });
    const [row] = await rowsOf(userId);
    expect(row?.status).toBe("pending");
    expect(reports).toStrictEqual([
      {
        error: failure,
        context: { surface: "account-export-send", exportId: row?.id, userId },
      },
    ]);
  });
});

describe("failExport", () => {
  it.each(["pending", "building"] as const)(
    "marks a %s export failed and reports its ids",
    async (status) => {
      const userId = newUlid();
      const row = await seedExport(userId, status);
      const reports: { error: unknown; context: Record<string, string> }[] = [];
      await failExport(db, row.id, (error, context) => {
        reports.push({ error, context });
      });
      const [after] = await rowsOf(userId);
      expect(after?.status).toBe("failed");
      expect(reports).toStrictEqual([
        {
          error: new Error("account export dead-lettered"),
          context: { surface: "account-export", exportId: row.id, userId },
        },
      ]);
    },
  );

  it("leaves a finished export alone, and still reports the dead letter", async () => {
    const userId = newUlid();
    const row = await seedExport(userId, "ready");
    const reports: Record<string, string>[] = [];
    await failExport(db, row.id, (_error, context) => {
      reports.push(context);
    });
    const [after] = await rowsOf(userId);
    expect(after?.status).toBe("ready");
    expect(reports).toStrictEqual([
      { surface: "account-export", exportId: row.id, userId: "unknown" },
    ]);
  });
});

async function readyExport(userId: string, expiresAt = NOW + 60) {
  const row = await seedExport(userId, "ready", {
    readyAt: NOW - 86_400 * 2,
    expiresAt,
  });
  await env.IMPORTS.put(keyOf(row), "zip bytes");
  return row;
}

function locationOf(response: Response) {
  return {
    status: response.status,
    location: response.headers.get("location"),
  };
}

describe("exportFileResponse", () => {
  it("hands the owner their ZIP, as an attachment named for its day, never cached", async () => {
    const userId = newUlid();
    const row = await readyExport(userId);
    const response = await exportFileResponse(
      db,
      { token: row.linkToken, userId },
      env.IMPORTS,
      NOW,
    );
    expect(response.status).toBe(200);
    expect(Object.fromEntries(response.headers)).toStrictEqual({
      "content-type": "application/zip",
      "content-disposition":
        'attachment; filename="dialed-run-export-2027-01-08.zip"',
      "content-length": "9",
      "cache-control": "private, no-store",
    });
    expect(new TextDecoder().decode(await response.arrayBuffer())).toBe(
      "zip bytes",
    );
  });

  it("sends a signed-out runner to log in, and back to the export row", async () => {
    const userId = newUlid();
    const row = await readyExport(userId);
    expect(
      locationOf(
        await exportFileResponse(
          db,
          { token: row.linkToken, userId: undefined },
          env.IMPORTS,
          NOW,
        ),
      ),
    ).toStrictEqual({
      status: 302,
      location: "/auth/login?redirect=%2Faccount%2Fsign-in",
    });
  });

  it("sends everything that is not the runner's live export to the row", async () => {
    const userId = newUlid();
    const live = await readyExport(userId);
    const expired = await readyExport(userId, NOW);
    // Staged, but not ready: only the status stops it.
    const pending = await seedExport(userId, "building", {
      requestedAt: NOW - 30,
      expiresAt: NOW + 60,
    });
    await env.IMPORTS.put(keyOf(pending), "partial");
    const undated = await seedExport(userId, "ready");
    await env.IMPORTS.put(keyOf(undated), "zip bytes");
    const gone = await readyExport(userId);
    await env.IMPORTS.delete(keyOf(gone));
    // Ready and dated but never claimed: no build's key, so no ZIP.
    const unclaimed = await seedExport(userId, "ready", {
      claimId: undefined,
      expiresAt: NOW + 60,
    });
    const cases = [
      { token: "not-a-token", userId },
      { token: newLinkToken(), userId },
      // Someone else's, even signed in.
      { token: live.linkToken, userId: newUlid() },
      { token: expired.linkToken, userId },
      { token: pending.linkToken, userId },
      { token: undated.linkToken, userId },
      { token: gone.linkToken, userId },
      { token: unclaimed.linkToken, userId },
    ];
    for (const request of cases) {
      expect(
        locationOf(await exportFileResponse(db, request, env.IMPORTS, NOW)),
      ).toStrictEqual({ status: 302, location: "/account/sign-in" });
    }
  });
});
