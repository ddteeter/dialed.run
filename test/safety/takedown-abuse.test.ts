import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/d1";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { z } from "zod";

import {
  outbox,
  outfitEntries,
  takedownBlocks,
  takedownRequests,
} from "../../src/db/schema-core";
import { env } from "../../src/env";
import { newUlid } from "../../src/lib/ids";
import { readOutboxRow } from "../../src/lib/sql/outbox";
import { decideRemovalRequest } from "../../src/modules/feed/removal-requests";
import {
  blockAndDeclineAll,
  confirmTakedownRequest,
  fileTakedownRequest,
  pendingTakedownRequests,
} from "../../src/modules/safety";
import { ipKey, requesterKey } from "../../src/modules/safety/requester-key";
import {
  TAKEDOWN_CAP,
  TAKEDOWN_VALVE_PER_HOUR,
  valveHour,
} from "../../src/modules/safety/takedown-limits";
import { oweInCore } from "../queue-fakes";

import { makeEntry, makeRun, makeUser, resetSafetyTables } from "./helpers";

/**
 * `/takedown`'s abuse limits (design 137; owner, 2026-10-10): a cap of
 * two open requests per requester, a valve of ten hides an hour, and a
 * silent receipt for a blocked requester.
 */
const NOW = 1_800_000_000;
const ADMINS = env.ADMIN_USER_IDS;
const SECRET = "test-takedown-secret";

function core() {
  return drizzle(env.DIALED_CORE);
}

const deps = {
  verify: () => Promise.resolve({ ok: true }),
  owe: oweInCore,
  secret: SECRET,
};

async function sharedEntry(): Promise<string> {
  const author = await makeUser();
  const runId = await makeRun({ userId: author });
  return makeEntry({ userId: author, runId, audience: "runners" });
}

const entryLink = (entryId: string) =>
  `https://dialed.run/feed/entry/${entryId}`;

async function file(
  email: string,
  location: string,
  options: { ip?: string; secret?: string | undefined; now?: number } = {},
) {
  await fileTakedownRequest(
    core(),
    {
      email,
      signature: "Sam Runner",
      location,
      description: "",
      isAttested: true,
      idempotencyKey: newUlid(),
      attempt: "token",
      remoteIp: options.ip ?? "203.0.113.9",
      isLimited: false,
    },
    { ...deps, secret: "secret" in options ? options.secret : SECRET },
    options.now ?? NOW,
  );
  const [row] = await core()
    .select()
    .from(takedownRequests)
    .where(eq(takedownRequests.location, location));
  if (row === undefined) throw new Error("no request filed");
  return row;
}

async function entryStatus(entryId: string) {
  const [row] = await core()
    .select({ status: outfitEntries.moderationStatus })
    .from(outfitEntries)
    .where(eq(outfitEntries.id, entryId));
  return row?.status;
}

const owedTemplate = z.object({ kind: z.string() }).loose();
const owedEmail = z.object({
  dedupeKey: z.string(),
  email: z.object({ to: z.unknown(), template: owedTemplate }),
});

type OwedEmail = z.infer<typeof owedEmail>;

async function owed() {
  const rows = await core()
    .select({ payload: outbox.payload })
    .from(outbox)
    .where(eq(outbox.kind, "email"));
  return rows.map((row) => {
    const read = readOutboxRow("email", row.payload);
    if (!read.ok) throw new Error(read.problem);
    return owedEmail.parse(read.message.payload);
  });
}

async function owedWhere(
  isWanted: (email: OwedEmail) => boolean,
): Promise<OwedEmail[]> {
  const emails = await owed();
  return emails.filter((email) => isWanted(email));
}

async function kindsOwed(): Promise<string[]> {
  const emails = await owed();
  return emails
    .map((email) => email.email.template.kind)
    .toSorted((one, other) => one.localeCompare(other));
}

async function stateOf(email: string, location: string) {
  const row = await file(email, location);
  return row.holdState;
}

async function pastTheCap() {
  const a = await sharedEntry();
  const b = await sharedEntry();
  const c = await sharedEntry();
  await file("me@example.com", entryLink(a));
  await file("me@example.com", entryLink(b));
  const third = await file("me@example.com", entryLink(c));
  return { entryId: c, request: third };
}

const tokenOf = z.object({ confirmToken: z.string() }).loose();

async function confirmTokenFor(requestId: string): Promise<string> {
  const emails = await owed();
  const receipt = emails.find(
    (email) => email.dedupeKey === `removal_request_received:${requestId}`,
  );
  return tokenOf.parse(receipt?.email.template).confirmToken;
}

beforeEach(async () => {
  await resetSafetyTables();
  await core().delete(takedownRequests);
  await core().delete(takedownBlocks);
  Reflect.set(env, "ADMIN_USER_IDS", "op-one,op-two");
});

afterEach(() => {
  if (ADMINS === undefined) Reflect.deleteProperty(env, "ADMIN_USER_IDS");
  else Reflect.set(env, "ADMIN_USER_IDS", ADMINS);
});

describe("the requester cap", () => {
  it("is two open requests, by the inbox, whatever the address's dots and tags", async () => {
    expect(TAKEDOWN_CAP).toBe(2);
    const entries = [
      await sharedEntry(),
      await sharedEntry(),
      await sharedEntry(),
    ];
    const first = await file("me@gmail.com", entryLink(entries[0] ?? ""), {
      ip: "198.51.100.1",
    });
    const second = await file("m.e+2@gmail.com", entryLink(entries[1] ?? ""), {
      ip: "198.51.100.2",
    });
    const third = await file(
      "ME+3@googlemail.com",
      entryLink(entries[2] ?? ""),
      {
        ip: "198.51.100.3",
      },
    );

    expect([first.holdState, second.holdState, third.holdState]).toStrictEqual([
      "held",
      "held",
      "confirm",
    ]);
    expect(third.requesterKey).toBe("me@gmail.com");
    expect(third.heldAt).toBeNull();
    expect(third.confirmTokenHash).toMatch(/^[\da-f]{64}$/u);
    expect(await entryStatus(entries[2] ?? "")).toBe("ok");
    // The third alerts nobody until it is confirmed.
    expect(
      await owedWhere((email) =>
        email.dedupeKey.startsWith(`removal_requested:${third.id}`),
      ),
    ).toStrictEqual([]);
    expect(await confirmTokenFor(third.id)).toMatch(/^[\da-f]{64}$/u);
  });

  it("counts by the IP key too, when the secret is set", async () => {
    const a = await sharedEntry();
    const b = await sharedEntry();
    const c = await sharedEntry();
    await file("one@example.com", entryLink(a));
    await file("two@example.com", entryLink(b));
    const third = await file("three@example.com", entryLink(c));
    expect(third.holdState).toBe("confirm");
    expect(third.ipKey).toMatch(/^[\da-f]{64}$/u);
  });

  it("matches by email alone without the secret", async () => {
    const a = await sharedEntry();
    const b = await sharedEntry();
    const c = await sharedEntry();
    await file("one@example.com", entryLink(a), { secret: undefined });
    await file("two@example.com", entryLink(b), { secret: undefined });
    const third = await file("three@example.com", entryLink(c), {
      secret: undefined,
    });
    expect(third.holdState).toBe("held");
    expect(third.ipKey).toBeNull();
  });

  it("frees a place once a request is decided", async () => {
    const a = await sharedEntry();
    const b = await sharedEntry();
    const c = await sharedEntry();
    const first = await file("me@example.com", entryLink(a));
    await file("me@example.com", entryLink(b));
    await decideRemovalRequest(core(), "op-one", first.id, {
      outcome: "declined",
      reason: "shoes",
    });
    expect(await stateOf("me@example.com", entryLink(c))).toBe("held");
  });

  it("records a link that is not ours with no hold state when it may alert", async () => {
    const row = await file("me@example.com", "https://elsewhere.example/x");
    expect(row.holdState).toBeNull();
    expect(row.heldAt).toBeNull();
    expect(await kindsOwed()).toStrictEqual([
      "removal_request_received",
      "removal_requested",
      "removal_requested",
    ]);
  });
});

describe("the confirm", () => {
  it("hides it and alerts every operator, once", async () => {
    const { entryId, request } = await pastTheCap();
    const token = await confirmTokenFor(request.id);

    expect(
      await confirmTakedownRequest(core(), token, oweInCore, NOW + 60),
    ).toBe("confirmed");
    expect(await entryStatus(entryId)).toBe("hidden_pending_review");
    const [row] = await core()
      .select()
      .from(takedownRequests)
      .where(eq(takedownRequests.id, request.id));
    expect(row).toMatchObject({
      holdState: "held",
      heldAt: NOW + 60,
      confirmedAt: NOW + 60,
    });
    const alerts = await owedWhere((email) =>
      email.dedupeKey.startsWith(`removal_requested:${request.id}`),
    );
    expect(alerts.map((email) => email.email.to)).toStrictEqual([
      { userId: "op-one" },
      { userId: "op-two" },
    ]);
    expect(alerts[0]?.email.template).toStrictEqual({
      kind: "removal_requested",
      dueAt: request.dueAt,
      isOurs: true,
    });

    // A second press is the first: nothing new is owed.
    const before = await owed();
    expect(
      await confirmTakedownRequest(core(), token, oweInCore, NOW + 120),
    ).toBe("confirmed");
    expect(await owed()).toHaveLength(before.length);
  });

  it("refuses a token nobody was sent, and leaves a decided request decided", async () => {
    const { entryId, request } = await pastTheCap();
    expect(
      await confirmTakedownRequest(core(), "f".repeat(64), oweInCore, NOW),
    ).toBe("not_found");
    await decideRemovalRequest(core(), "op-one", request.id, {
      outcome: "declined",
      reason: "shoes",
    });
    expect(
      await confirmTakedownRequest(
        core(),
        await confirmTokenFor(request.id),
        oweInCore,
        NOW,
      ),
    ).toBe("decided");
    expect(await entryStatus(entryId)).toBe("ok");
  });

  it("hides nothing while the valve is shut, and owes its alert instead", async () => {
    const { entryId, request } = await pastTheCap();
    // The first two requests hid theirs at NOW: with these, exactly ten.
    await heldThisHour(TAKEDOWN_VALVE_PER_HOUR - 2, NOW + 60);
    await confirmTakedownRequest(
      core(),
      await confirmTokenFor(request.id),
      oweInCore,
      NOW + 60,
    );
    expect(await entryStatus(entryId)).toBe("ok");
    const [row] = await core()
      .select({ holdState: takedownRequests.holdState })
      .from(takedownRequests)
      .where(eq(takedownRequests.id, request.id));
    expect(row?.holdState).toBe("valve");
    expect(
      await owedWhere((email) => email.dedupeKey.startsWith("takedown_valve:")),
    ).toHaveLength(2);
  });
});

/**
`count` requests that hid something just before `at`, from strangers.
*/
async function heldThisHour(count: number, at: number): Promise<void> {
  for (let index = 0; index < count; index += 1) {
    await core()
      .insert(takedownRequests)
      .values({
        id: newUlid(),
        requesterEmail: `flood${String(index)}@example.com`,
        signature: "x",
        location: "x",
        dueAt: at,
        createdAt: at - 60,
        idempotencyKey: newUlid(),
        requesterKey: `flood${String(index)}@example.com`,
        holdState: "held",
        heldAt: at - 60,
        status: "declined",
      });
  }
}

describe("the valve", () => {
  it("is ten hides an hour, and then a request hides nothing and alerts once an hour", async () => {
    expect(TAKEDOWN_VALVE_PER_HOUR).toBe(10);
    await heldThisHour(TAKEDOWN_VALVE_PER_HOUR, NOW);
    const a = await sharedEntry();
    const b = await sharedEntry();
    const first = await file("one@example.com", entryLink(a), {
      ip: "198.51.100.1",
    });
    await file("two@example.com", entryLink(b), { ip: "198.51.100.2" });

    expect(first.holdState).toBe("valve");
    expect(first.heldAt).toBeNull();
    expect(await entryStatus(a)).toBe("ok");
    const valve = await owedWhere(
      (email) => email.email.template.kind === "takedown_valve",
    );
    expect(valve.map((email) => email.dedupeKey)).toStrictEqual([
      `takedown_valve:${String(valveHour(NOW))}:op-one`,
      `takedown_valve:${String(valveHour(NOW))}:op-two`,
    ]);
    expect(valve[0]?.email.template).toStrictEqual({
      kind: "takedown_valve",
      perHour: 10,
    });
    expect(
      await owedWhere(
        (email) => email.email.template.kind === "removal_requested",
      ),
    ).toStrictEqual([]);
  });

  it("opens again an hour after the hides", async () => {
    await heldThisHour(TAKEDOWN_VALVE_PER_HOUR, NOW - 3600);
    const a = await sharedEntry();
    expect(await stateOf("one@example.com", entryLink(a))).toBe("held");
  });

  it("shuts at exactly ten, not before", async () => {
    await heldThisHour(TAKEDOWN_VALVE_PER_HOUR - 1, NOW);
    const a = await sharedEntry();
    expect(await stateOf("one@example.com", entryLink(a))).toBe("held");
  });
});

describe("a blocked requester", () => {
  it("gets the ordinary receipt, and nothing hides and nobody is alerted", async () => {
    await core()
      .insert(takedownBlocks)
      .values({
        key: requesterKey("me@example.com"),
        kind: "email",
        createdAt: NOW,
        createdBy: "op-one",
      });
    const a = await sharedEntry();
    const row = await file("Me+x@Example.com", entryLink(a));
    expect(row.holdState).toBe("blocked");
    expect(await entryStatus(a)).toBe("ok");
    const emails = await owed();
    expect(emails.map((email) => email.email.template)).toStrictEqual([
      {
        kind: "removal_request_received",
        dueAt: NOW + 172_800,
        isHidden: false,
      },
    ]);
  });
});

describe("Block and decline all", () => {
  it("declines every open request of the requester's, gives back what they hid, blocks both keys, and emails no outcome", async () => {
    const a = await sharedEntry();
    const b = await sharedEntry();
    const other = await sharedEntry();
    const first = await file("me@example.com", entryLink(a));
    const second = await file("me+2@example.com", entryLink(b), {
      ip: "198.51.100.7",
    });
    const stranger = await file("you@example.com", entryLink(other), {
      ip: "198.51.100.8",
    });

    expect(
      await blockAndDeclineAll(core(), "op-one", second.id, NOW + 10),
    ).toStrictEqual({ status: "blocked", declined: 2 });

    const rows = await core().select().from(takedownRequests);
    const statusOf = (id: string) => rows.find((row) => row.id === id)?.status;
    expect([
      statusOf(first.id),
      statusOf(second.id),
      statusOf(stranger.id),
    ]).toStrictEqual(["declined", "declined", "pending"]);
    expect(rows.find((row) => row.id === first.id)).toMatchObject({
      declineReason: "Blocked as abuse",
      resolvedAt: NOW + 10,
      resolvedBy: "op-one",
    });
    expect(await entryStatus(a)).toBe("ok");
    expect(await entryStatus(b)).toBe("ok");
    expect(await entryStatus(other)).toBe("hidden_pending_review");
    const blocks = await core().select().from(takedownBlocks);
    expect(
      blocks
        .map((block) => `${block.kind} ${block.createdBy}`)
        .toSorted((one, other) => one.localeCompare(other)),
    ).toStrictEqual(["email op-one", "ip op-one"]);
    expect(blocks.find((block) => block.kind === "email")?.key).toBe(
      "me@example.com",
    );
    expect(blocks.find((block) => block.kind === "ip")?.key).toBe(second.ipKey);
    expect(await kindsOwed()).not.toContain("removal_request_decided");
  });

  it("blocks by email alone for a request with no IP key, and says not found for none", async () => {
    const a = await sharedEntry();
    const row = await file("me@example.com", entryLink(a), {
      secret: undefined,
    });
    expect(await blockAndDeclineAll(core(), "op-one", row.id, NOW)).toEqual({
      status: "blocked",
      declined: 1,
    });
    const blocks = await core().select().from(takedownBlocks);
    expect(blocks.map((block) => block.kind)).toStrictEqual(["email"]);
    expect(
      await blockAndDeclineAll(core(), "op-one", newUlid(), NOW),
    ).toStrictEqual({ status: "not_found" });
  });
});

describe("the poster's username (round 37 #59g)", () => {
  it("is kept as the requester gave it, normalised, and listed for Review", async () => {
    await fileTakedownRequest(
      core(),
      {
        email: "me@example.com",
        signature: "Sam Runner",
        location: "at the finish line",
        description: "",
        posterUsername: "maya_runs",
        isAttested: true,
        idempotencyKey: newUlid(),
        attempt: "token",
        remoteIp: "203.0.113.9",
        isLimited: false,
      },
      deps,
      NOW,
    );
    const [listed] = await pendingTakedownRequests(core(), NOW);
    expect(listed?.posterUsername).toBe("maya_runs");
  });

  it("is absent when it was not given", async () => {
    await file("me@example.com", "somewhere");
    const [listed] = await pendingTakedownRequests(core(), NOW);
    expect(listed?.posterUsername).toBeUndefined();
  });
});

describe("Review's list", () => {
  it("says what filing decided and links the requester's other requests", async () => {
    const a = await sharedEntry();
    const b = await sharedEntry();
    const first = await file("me@example.com", entryLink(a));
    const second = await file("me+x@example.com", entryLink(b), {
      ip: "198.51.100.9",
    });
    const stranger = await file("you@example.com", "somewhere", {
      ip: "198.51.100.10",
    });
    const listed = await pendingTakedownRequests(core(), NOW);
    const byId = (id: string) => listed.find((row) => row.id === id);
    expect(byId(first.id)).toMatchObject({
      holdState: "held",
      relatedIds: [second.id],
    });
    expect(byId(second.id)?.relatedIds).toStrictEqual([first.id]);
    expect(byId(stranger.id)).toMatchObject({
      holdState: undefined,
      relatedIds: [],
    });
  });

  it("links by the IP key when the emails differ", async () => {
    const one = await file("one@example.com", "somewhere-1");
    const two = await file("two@example.com", "somewhere-2");
    const listed = await pendingTakedownRequests(core(), NOW);
    expect(listed.find((row) => row.id === one.id)?.relatedIds).toStrictEqual([
      two.id,
    ]);
  });
});

/**
`/takedown` rows written before design 137's keys existed: no `requester_key`, no `ip_key`.
*/
async function legacyRequest(email: string, location: string) {
  const id = newUlid();
  await core()
    .insert(takedownRequests)
    .values({
      id,
      requesterEmail: email,
      signature: "x",
      location,
      dueAt: NOW + 172_800,
      createdAt: NOW,
      idempotencyKey: newUlid(),
    });
  return id;
}

describe("what filing decides, at its edges", () => {
  it("records a blocked requester's link that is not ours as blocked", async () => {
    await core().insert(takedownBlocks).values({
      key: "me@example.com",
      kind: "email",
      createdAt: NOW,
      createdBy: "op-one",
    });
    const row = await file("me@example.com", "https://elsewhere.example/x");
    expect(row.holdState).toBe("blocked");
  });

  it("blocks by the address alone without the secret", async () => {
    await core().insert(takedownBlocks).values({
      key: "me@example.com",
      kind: "email",
      createdAt: NOW,
      createdBy: "op-one",
    });
    const a = await sharedEntry();
    const row = await file("me@example.com", entryLink(a), {
      secret: undefined,
    });
    expect(row.holdState).toBe("blocked");
  });

  it("blocks by the IP key alone, whatever address it comes from", async () => {
    await core()
      .insert(takedownBlocks)
      .values({
        key: (await ipKey("203.0.113.9", SECRET)) ?? "",
        kind: "ip",
        createdAt: NOW,
        createdBy: "op-one",
      });
    const a = await sharedEntry();
    const row = await file("fresh@example.com", entryLink(a));
    expect(row.holdState).toBe("blocked");
    expect(await entryStatus(a)).toBe("ok");
  });

  it("names the hour a valve alert is about", () => {
    expect(valveHour(0)).toBe(0);
    expect(valveHour(3599)).toBe(0);
    expect(valveHour(3600)).toBe(1);
    expect(valveHour(NOW)).toBe(500_000);
  });
});

describe("the confirm, at its edges", () => {
  it("confirms a link that is not ours without hiding anything, and says so to the operators", async () => {
    const a = await sharedEntry();
    const b = await sharedEntry();
    await file("me@example.com", entryLink(a));
    await file("me@example.com", entryLink(b));
    const third = await file("me@example.com", "https://elsewhere.example/x");
    expect(third.holdState).toBe("confirm");

    await confirmTakedownRequest(
      core(),
      await confirmTokenFor(third.id),
      oweInCore,
      NOW + 60,
    );
    const [row] = await core()
      .select()
      .from(takedownRequests)
      .where(eq(takedownRequests.id, third.id));
    expect(row?.holdState).toBe("held");
    expect(row?.heldAt).toBeNull();
    const alerts = await owedWhere((email) =>
      email.dedupeKey.startsWith(`removal_requested:${third.id}`),
    );
    expect(alerts.map((email) => email.email.template)).toStrictEqual([
      { kind: "removal_requested", dueAt: third.dueAt, isOurs: false },
      { kind: "removal_requested", dueAt: third.dueAt, isOurs: false },
    ]);
  });

  it("does nothing on a second press, even once the valve has shut", async () => {
    const { request } = await pastTheCap();
    const token = await confirmTokenFor(request.id);
    await confirmTakedownRequest(core(), token, oweInCore, NOW + 60);
    await heldThisHour(TAKEDOWN_VALVE_PER_HOUR, NOW + 120);
    expect(
      await confirmTakedownRequest(core(), token, oweInCore, NOW + 120),
    ).toBe("confirmed");
    expect(
      await owedWhere((email) => email.dedupeKey.startsWith("takedown_valve:")),
    ).toStrictEqual([]);
  });
});

describe("requests filed before the keys existed", () => {
  it("are linked in Review by their address's inbox, and not by their missing IP key", async () => {
    const first = await legacyRequest("Me+x@example.com", "somewhere-1");
    const second = await legacyRequest("me@example.com", "somewhere-2");
    const stranger = await legacyRequest("you@example.com", "somewhere-3");
    const listed = await pendingTakedownRequests(core(), NOW);
    const relatedOf = (id: string) =>
      listed.find((row) => row.id === id)?.relatedIds;
    expect(relatedOf(first)).toStrictEqual([second]);
    expect(relatedOf(stranger)).toStrictEqual([]);
  });

  it("are blocked by their address's inbox", async () => {
    const id = await legacyRequest("Me+x@example.com", "somewhere");
    expect(await blockAndDeclineAll(core(), "op-one", id, NOW)).toStrictEqual({
      status: "blocked",
      declined: 1,
    });
    const blocks = await core().select().from(takedownBlocks);
    expect(blocks.map((block) => block.key)).toStrictEqual(["me@example.com"]);
  });
});

describe("Block and decline all, for a link that is not ours", () => {
  it("declines it, with nothing to give back", async () => {
    const row = await file("me@example.com", "https://elsewhere.example/x");
    expect(
      await blockAndDeclineAll(core(), "op-one", row.id, NOW),
    ).toStrictEqual({ status: "blocked", declined: 1 });
    const [after] = await core()
      .select({ status: takedownRequests.status })
      .from(takedownRequests)
      .where(eq(takedownRequests.id, row.id));
    expect(after?.status).toBe("declined");
  });
});
