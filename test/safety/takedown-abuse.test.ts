import { eq, inArray } from "drizzle-orm";
import { drizzle } from "drizzle-orm/d1";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { z } from "zod";

import {
  entryPhotos,
  notifications,
  outbox,
  outfitEntries,
  reviewQueue,
  takedownBlocks,
  takedownRequests,
  userProfiles,
} from "../../src/db/schema-core";
import { env } from "../../src/env";
import { removalRequestReceived } from "../../src/lib/contracts/email-kinds";
import { newUlid, ulidSchema } from "../../src/lib/ids";
import { readOutboxRow } from "../../src/lib/sql/outbox";
import { decideRemovalRequest } from "../../src/modules/feed/moderation/removal-requests";
import {
  mintReceiptConfirmToken,
  requestSubjectOf,
} from "../../src/modules/safety";
import {
  blockAndDeclineAll,
  confirmTakedownRequest,
  fileTakedownRequest,
  pendingTakedownRequests,
  REMOVAL_REQUESTS_PURGE_KEY,
} from "../../src/modules/safety/takedowns/takedown-requests";
import {
  ipKey,
  requesterKey,
} from "../../src/modules/safety/takedowns/requester-key";
import {
  confirmTokenHash,
  TAKEDOWN_CAP,
  TAKEDOWN_VALVE_PER_HOUR,
  valveHour,
} from "../../src/modules/safety/limits/takedown-limits";
import { emailHandler } from "../../src/modules/ops/owed-email/owed-email";
import { queriesDuring } from "../d1-spy";
import { fakeMail } from "../email/helpers";
import { noPurge, purgeSpy } from "../purge-spy";
import type { PurgeTags } from "../../src/lib/cache-tags";
import { resolveReview } from "../../src/modules/safety/review/review";
import { oweInCoreWhere } from "../../src/modules/ops/outbox/owe-in-core";

import { makeEntry, makeRun, makeUser, resetSafetyTables } from "./helpers";

/**
 * `/takedown`'s abuse limits (design 137; owner, 2026-10-10): a cap of
 * two open requests per requester, a valve of ten hides an hour, and a
 * silent receipt for a blocked requester.
 */
const NOW = 1_800_000_000;
const ADMINS = env.ADMIN_USER_IDS;
/**
A column D1 left empty, as drizzle reads it back.
*/
const NOT_SET = z.null().parse(JSON.parse("null"));
const SECRET = "test-takedown-secret";

function core() {
  return drizzle(env.DIALED_CORE);
}

const deps = {
  verify: () => Promise.resolve({ ok: true }),
  oweWhere: oweInCoreWhere,
  purge: noPurge,
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
  options: {
    ip?: string;
    secret?: string | undefined;
    now?: number;
    purge?: PurgeTags;
  } = {},
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
    {
      ...deps,
      purge: options.purge ?? noPurge,
      secret: "secret" in options ? options.secret : SECRET,
    },
    options.now ?? NOW,
  );
  const [row] = await core()
    .select()
    .from(takedownRequests)
    .where(eq(takedownRequests.location, location));
  if (row === undefined) throw new Error("no request filed");
  return row;
}

async function ownerOf(entryId: string) {
  const [row] = await core()
    .select({ userId: outfitEntries.userId })
    .from(outfitEntries)
    .where(eq(outfitEntries.id, entryId));
  return row?.userId ?? "nobody";
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
    .select({ kind: outbox.kind, payload: outbox.payload })
    .from(outbox)
    // A receipt is `email`, an operator's alert `operator_email` (design 232).
    .where(inArray(outbox.kind, ["email", "operator_email"]));
  return rows.map((row) => {
    const read = readOutboxRow(row.kind, row.payload);
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

const waitingOn = z.strictObject({
  kind: z.literal("removal_request_received"),
  dueAt: z.number(),
  isHidden: z.boolean(),
  confirmRequestId: z.string(),
});

/**
 * The token the receipt's link will carry: the receipt is owed with the
 * request and no token (SA-L18), and the token is minted as it is sent,
 * which is what this does.
 */
async function confirmTokenFor(requestId: string): Promise<string> {
  const emails = await owed();
  const receipt = emails.find(
    (email) => email.dedupeKey === `removal_request_received:${requestId}`,
  );
  expect(waitingOn.parse(receipt?.email.template).confirmRequestId).toBe(
    requestId,
  );
  const token = await mintReceiptConfirmToken(core(), requestId);
  if (token === undefined) throw new Error("the request no longer waits");
  return token;
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
    // SA-L18: no token exists until the receipt is sent.
    expect(third.confirmTokenHash).toBeNull();
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
    const spy = purgeSpy();

    expect(
      await confirmTakedownRequest(
        core(),
        token,
        { oweWhere: oweInCoreWhere, purge: spy.purge },
        NOW + 60,
      ),
    ).toBe("confirmed");
    expect(await entryStatus(entryId)).toBe("hidden_pending_review");
    // Design 163: the hidden kit leaves the edge, with its runner's pages.
    expect(spy.calls).toStrictEqual([
      [`entry:${entryId}`, `runner:${await ownerOf(entryId)}`],
    ]);
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
      await confirmTakedownRequest(
        core(),
        token,
        { oweWhere: oweInCoreWhere, purge: noPurge },
        NOW + 120,
      ),
    ).toBe("confirmed");
    expect(await owed()).toHaveLength(before.length);
  });

  it("tells the author of what it hides only once it hides it (R-163)", async () => {
    const { entryId, request } = await pastTheCap();
    const hidden = () =>
      core()
        .select({ subjectId: notifications.subjectId })
        .from(notifications)
        .where(eq(notifications.subjectId, entryId));
    // The two before it were held at filing; this one waited.
    expect(await hidden()).toStrictEqual([]);

    await confirmTakedownRequest(
      core(),
      await confirmTokenFor(request.id),
      { oweWhere: oweInCoreWhere, purge: noPurge },
      NOW + 60,
    );

    expect(await hidden()).toStrictEqual([{ subjectId: entryId }]);
  });

  it("refuses a token nobody was sent, and leaves a decided request decided", async () => {
    const { entryId, request } = await pastTheCap();
    expect(
      await confirmTakedownRequest(
        core(),
        "f".repeat(64),
        { oweWhere: oweInCoreWhere, purge: noPurge },
        NOW,
      ),
    ).toBe("not_found");
    // The receipt went before the decision.
    const sent = await confirmTokenFor(request.id);
    await decideRemovalRequest(core(), "op-one", request.id, {
      outcome: "declined",
      reason: "shoes",
    });
    expect(
      await confirmTakedownRequest(
        core(),
        sent,
        { oweWhere: oweInCoreWhere, purge: noPurge },
        NOW,
      ),
    ).toBe("decided");
    expect(await entryStatus(entryId)).toBe("ok");
  });

  it("hides nothing while the valve is shut, and owes its alert instead", async () => {
    const { entryId, request } = await pastTheCap();
    // The first two requests hid theirs at NOW: with these, exactly ten.
    await heldThisHour(TAKEDOWN_VALVE_PER_HOUR - 2, NOW + 60);
    const spy = purgeSpy();
    await confirmTakedownRequest(
      core(),
      await confirmTokenFor(request.id),
      { oweWhere: oweInCoreWhere, purge: spy.purge },
      NOW + 60,
    );
    expect(await entryStatus(entryId)).toBe("ok");
    // Nothing hidden, so nothing to purge.
    expect(spy.calls).toStrictEqual([]);
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
`count` requests that newly hid something just before `at`, from strangers.
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
        hidAt: at - 60,
        status: "declined",
      });
  }
}

describe("the valve", () => {
  it("counts subjects newly hidden, not requests: many naming one kit take one place", async () => {
    const once = await sharedEntry();
    for (let index = 0; index < TAKEDOWN_VALVE_PER_HOUR; index += 1) {
      await file(`one${String(index)}@example.com`, entryLink(once), {
        ip: `198.51.100.${String(index + 1)}`,
      });
    }
    const hiders = await core()
      .select({ hidAt: takedownRequests.hidAt })
      .from(takedownRequests)
      .where(eq(takedownRequests.subjectId, once));
    expect(hiders.filter((row) => row.hidAt === NOW)).toHaveLength(1);

    const next = await sharedEntry();
    const row = await file("next@example.com", entryLink(next), {
      ip: "203.0.113.77",
    });
    expect(row).toMatchObject({ holdState: "held", heldAt: NOW, hidAt: NOW });
    expect(await entryStatus(next)).toBe("hidden_pending_review");
  });

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

  it("is listed beside the kit's real owner, read from the kit", async () => {
    // Another runner first, so a read that ignored whose kit it is would
    // find them.
    await makeUser({ username: "first_runner" });
    const author = await makeUser({ username: "real_owner" });
    const entryId = await makeEntry({
      userId: author,
      runId: await makeRun({ userId: author }),
      audience: "runners",
    });
    await fileTakedownRequest(
      core(),
      {
        email: "me@example.com",
        signature: "Sam Runner",
        location: entryLink(entryId),
        description: "",
        posterUsername: "someone_else",
        isAttested: true,
        idempotencyKey: newUlid(),
        attempt: "token",
        remoteIp: "203.0.113.9",
        isLimited: false,
      },
      deps,
      NOW,
    );
    await file("you@example.com", "https://elsewhere.example/x", {
      ip: "198.51.100.3",
    });

    const listed = await pendingTakedownRequests(core(), NOW);

    expect(
      listed.map((request) => [request.owner, request.posterUsername]),
    ).toStrictEqual([
      ["real_owner", "someone_else"],
      [undefined, undefined],
    ]);
  });

  it("names no owner for a kit whose author has no handle yet", async () => {
    const author = await makeUser();
    await core()
      .update(userProfiles)
      .set({ username: NOT_SET })
      .where(eq(userProfiles.userId, author));
    const entryId = await makeEntry({
      userId: author,
      runId: await makeRun({ userId: author }),
      audience: "runners",
    });
    await file("me@example.com", entryLink(entryId));

    const [listed] = await pendingTakedownRequests(core(), NOW);

    expect(listed?.owner).toBeUndefined();
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

  it("hashes a confirm token as SHA-256 hex, two digits a byte, zero bytes included", async () => {
    // A fixed vector rather than a random token: SHA-256("abc") has the
    // bytes 0x01, 0x03 and 0x00 in it, so a byte written without its
    // leading zero shortens the hash every time, not one run in eight.
    expect(await confirmTokenHash("abc")).toBe(
      "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad",
    );
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
      { oweWhere: oweInCoreWhere, purge: noPurge },
      NOW + 60,
    );
    const [row] = await core()
      .select()
      .from(takedownRequests)
      .where(eq(takedownRequests.id, third.id));
    // As at filing: a link that is not ours records no state of "held".
    expect(row?.holdState).toBeNull();
    expect(row?.confirmedAt).toBe(NOW + 60);
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
    await confirmTakedownRequest(
      core(),
      token,
      { oweWhere: oweInCoreWhere, purge: noPurge },
      NOW + 60,
    );
    await heldThisHour(TAKEDOWN_VALVE_PER_HOUR, NOW + 120);
    expect(
      await confirmTakedownRequest(
        core(),
        token,
        { oweWhere: oweInCoreWhere, purge: noPurge },
        NOW + 120,
      ),
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

/**
The receipt's outbox row: its id and its stored payload.
*/
async function receiptRow(requestId: string) {
  const [row] = await core()
    .select({ id: outbox.id, payload: outbox.payload })
    .from(outbox)
    .where(eq(outbox.dedupeKey, `removal_request_received:${requestId}`));
  if (row === undefined) throw new Error("no receipt owed");
  const read = readOutboxRow("email", row.payload);
  if (!read.ok) throw new Error(read.problem);
  return { id: row.id, text: row.payload, message: read.message };
}

/**
The receipt, sent through the real email handler and a fake sender.
*/
async function sendReceipt(requestId: string): Promise<string> {
  const mail = fakeMail();
  const row = await receiptRow(requestId);
  if (row.message.kind !== "email") throw new Error("not an email");
  await emailHandler(() => mail).run(core(), row.message.payload, row.id);
  return JSON.stringify(mail.sent);
}

const LINKED_TOKEN = /takedown\/confirm\?token=([\da-f]{64})/u;

describe("the receipt's confirm token (SA-L18)", () => {
  it("is in no outbox row: the receipt is owed with its request", async () => {
    const { request } = await pastTheCap();
    const row = await receiptRow(request.id);
    expect(row.text).not.toContain("confirmToken");
    expect(row.text).toContain(`"confirmRequestId":"${request.id}"`);
  });

  it("is minted as the receipt is sent, and only its hash is kept", async () => {
    const { request } = await pastTheCap();
    const sent = await sendReceipt(request.id);
    const token = LINKED_TOKEN.exec(sent)?.[1] ?? "";
    const [row] = await core()
      .select({ hash: takedownRequests.confirmTokenHash })
      .from(takedownRequests)
      .where(eq(takedownRequests.id, request.id));
    expect(row?.hash).toBe(await confirmTokenHash(token));
    expect(
      await confirmTakedownRequest(
        core(),
        token,
        { oweWhere: oweInCoreWhere, purge: noPurge },
        NOW,
      ),
    ).toBe("confirmed");
  });

  it("is left off a receipt whose request no longer waits", async () => {
    const { request } = await pastTheCap();
    await decideRemovalRequest(core(), "op-one", request.id, {
      outcome: "declined",
      reason: "shoes",
    });
    const sent = await sendReceipt(request.id);
    expect(sent).not.toMatch(LINKED_TOKEN);
    expect(await mintReceiptConfirmToken(core(), request.id)).toBeUndefined();
  });

  it("leaves a receipt owed before it, with its own token, as it was (law 9)", async () => {
    const mail = fakeMail();
    const token = "a".repeat(64);
    await emailHandler(() => mail).run(
      core(),
      {
        dedupeKey: "removal_request_received:old",
        email: {
          to: { address: "me@example.com" },
          template: {
            kind: "removal_request_received",
            dueAt: NOW,
            isHidden: false,
            confirmToken: token,
          },
        },
      },
      "no-such-row",
    );
    expect(LINKED_TOKEN.exec(JSON.stringify(mail.sent))?.[1]).toBe(token);
  });

  it("still reads a receipt owed before it, whose token is the whole hex string (law 9)", () => {
    const owed = {
      kind: "removal_request_received",
      dueAt: NOW,
      isHidden: false,
      confirmToken: "c".repeat(64),
    };
    expect(removalRequestReceived.parse(owed)).toStrictEqual(owed);
    expect(
      removalRequestReceived.safeParse({ ...owed, confirmToken: "" }).success,
    ).toBe(false);
  });

  it("leaves a receipt whose request is unset as it was", async () => {
    const mail = fakeMail();
    const token = "b".repeat(64);
    await emailHandler(() => mail).run(
      core(),
      {
        dedupeKey: "removal_request_received:unset",
        email: {
          to: { address: "me@example.com" },
          template: {
            kind: "removal_request_received",
            dueAt: NOW,
            isHidden: false,
            confirmRequestId: undefined,
            confirmToken: token,
          },
        },
      },
      "no-such-row",
    );
    expect(LINKED_TOKEN.exec(JSON.stringify(mail.sent))?.[1]).toBe(token);
  });

  it("is none for a request nobody filed", async () => {
    expect(
      await mintReceiptConfirmToken(core(), "no-such-request"),
    ).toBeUndefined();
  });

  it("works only as the last one minted", async () => {
    const { request } = await pastTheCap();
    const first = await confirmTokenFor(request.id);
    const second = await confirmTokenFor(request.id);
    const effects = { oweWhere: oweInCoreWhere, purge: noPurge };
    expect(await confirmTakedownRequest(core(), first, effects, NOW)).toBe(
      "not_found",
    );
    expect(await confirmTakedownRequest(core(), second, effects, NOW)).toBe(
      "confirmed",
    );
  });

  it("works until the request's due time and not after", async () => {
    const effects = { oweWhere: oweInCoreWhere, purge: noPurge };
    const late = await pastTheCap();
    const lateToken = await confirmTokenFor(late.request.id);
    expect(
      await confirmTakedownRequest(
        core(),
        lateToken,
        effects,
        late.request.dueAt + 1,
      ),
    ).toBe("not_found");
    const due = await pastTheCap();
    const dueToken = await confirmTokenFor(due.request.id);
    expect(
      await confirmTakedownRequest(
        core(),
        dueToken,
        effects,
        due.request.dueAt,
      ),
    ).toBe("confirmed");
  });
});

/**
A request filed from its own address and inbox, as a burst's members are.
*/
function fileAlone(index: number, location: string) {
  return fileTakedownRequest(
    core(),
    {
      email: `burst${String(index)}@example.com`,
      signature: "Sam Runner",
      location,
      description: "",
      isAttested: true,
      idempotencyKey: newUlid(),
      attempt: "token",
      remoteIp: `203.0.113.${String(index)}`,
      isLimited: false,
    },
    deps,
    NOW,
  );
}

/**
A link that is not ours, one per request.
*/
function elsewhere(index: number): string {
  return `https://elsewhere.example/${String(index)}`;
}

async function hiddenKits(): Promise<number> {
  const rows = await core()
    .select({ id: outfitEntries.id })
    .from(outfitEntries)
    .where(eq(outfitEntries.moderationStatus, "hidden_pending_review"));
  return rows.length;
}

async function heldRows(): Promise<number> {
  const rows = await core().select().from(takedownRequests);
  return rows.filter((row) => row.heldAt !== null).length;
}

describe("the limits, for requests sent together", () => {
  it("hide ten however many filings arrive at once", async () => {
    const entries = await Promise.all(
      Array.from({ length: 15 }, () => sharedEntry()),
    );

    await Promise.all(
      entries.map((entryId, index) => fileAlone(index, entryLink(entryId))),
    );

    expect(await hiddenKits()).toBe(TAKEDOWN_VALVE_PER_HOUR);
    expect(await heldRows()).toBe(TAKEDOWN_VALVE_PER_HOUR);
    const states = await core()
      .select({ holdState: takedownRequests.holdState })
      .from(takedownRequests);
    expect(states.filter((row) => row.holdState === "valve")).toHaveLength(5);
  });

  it("hide ten however many confirms arrive at once", async () => {
    await file("me@example.com", entryLink(await sharedEntry()));
    await file("me@example.com", entryLink(await sharedEntry()));
    const waiting = [];
    for (let index = 0; index < 12; index += 1) {
      const entryId = await sharedEntry();
      waiting.push(await file("me@example.com", entryLink(entryId)));
    }
    const tokens = [];
    for (const row of waiting) tokens.push(await confirmTokenFor(row.id));

    await Promise.all(
      tokens.map((token) =>
        confirmTakedownRequest(
          core(),
          token,
          { oweWhere: oweInCoreWhere, purge: noPurge },
          NOW + 60,
        ),
      ),
    );

    expect(await heldRows()).toBe(TAKEDOWN_VALVE_PER_HOUR);
    expect(await hiddenKits()).toBe(TAKEDOWN_VALVE_PER_HOUR);
  });

  it("hold the requester to the cap however many of theirs arrive at once", async () => {
    const entries = await Promise.all(
      Array.from({ length: 5 }, () => sharedEntry()),
    );

    await Promise.all(
      entries.map((entryId) =>
        fileTakedownRequest(
          core(),
          {
            email: "me@example.com",
            signature: "Sam Runner",
            location: entryLink(entryId),
            description: "",
            isAttested: true,
            idempotencyKey: newUlid(),
            attempt: "token",
            remoteIp: "203.0.113.9",
            isLimited: false,
          },
          deps,
          NOW,
        ),
      ),
    );

    expect(await heldRows()).toBe(TAKEDOWN_CAP);
  });
});

describe("a request that names nothing a hold moves", () => {
  it("is not counted by the valve, purges nothing and says it hid nothing", async () => {
    const spy = purgeSpy();
    for (let index = 0; index < TAKEDOWN_VALVE_PER_HOUR; index += 1) {
      await fileTakedownRequest(
        core(),
        {
          email: `nobody${String(index)}@example.com`,
          signature: "Sam Runner",
          location: entryLink(newUlid()),
          description: "",
          isAttested: true,
          idempotencyKey: newUlid(),
          attempt: "token",
          remoteIp: `203.0.113.${String(index)}`,
          isLimited: false,
        },
        { ...deps, purge: spy.purge },
        NOW,
      );
    }
    expect(spy.calls).toStrictEqual([]);
    expect(await heldRows()).toBe(0);
    const receipts = await owedWhere(
      (email) => email.email.template.kind === "removal_request_received",
    );
    expect(
      receipts.every((email) => email.email.template.isHidden === false),
    ).toBe(true);

    const real = await sharedEntry();
    await file("someone@example.com", entryLink(real), { ip: "198.51.100.7" });

    expect(await entryStatus(real)).toBe("hidden_pending_review");
  });

  it("alerts one by one for ten an hour, then owes the valve's alert", async () => {
    for (let index = 0; index <= TAKEDOWN_VALVE_PER_HOUR; index += 1) {
      await fileAlone(index, elsewhere(index));
    }

    const rows = await core().select().from(takedownRequests);
    const rowAt = (index: number) =>
      rows.find((row) => row.location === elsewhere(index));
    expect(rowAt(0)).toMatchObject({ holdState: NOT_SET, alertedAt: NOW });
    expect(rowAt(TAKEDOWN_VALVE_PER_HOUR - 1)?.alertedAt).toBe(NOW);
    expect(rowAt(TAKEDOWN_VALVE_PER_HOUR)).toMatchObject({
      holdState: "valve",
      alertedAt: NOT_SET,
      heldAt: NOT_SET,
    });
    const alerted = await owedWhere(
      (email) => email.email.template.kind === "removal_requested",
    );
    expect(alerted).toHaveLength(2 * TAKEDOWN_VALVE_PER_HOUR);
    const valve = await owedWhere(
      (email) => email.email.template.kind === "takedown_valve",
    );
    expect(valve).toHaveLength(2);
  });

  it("alerts one by one again once the hour has passed", async () => {
    for (let index = 0; index < TAKEDOWN_VALVE_PER_HOUR; index += 1) {
      await fileAlone(index, elsewhere(index));
    }
    const later = await file(
      "later@example.com",
      "https://elsewhere.example/later",
      { now: NOW + 3660, ip: "198.51.100.40" },
    );
    expect(later.alertedAt).toBe(NOW + 3660);
  });

  it("holds a kit a copyright hold has removed, newly hiding nothing", async () => {
    const entryId = await sharedEntry();
    await core()
      .update(outfitEntries)
      .set({ moderationStatus: "removed" })
      .where(eq(outfitEntries.id, entryId));
    const spy = purgeSpy();

    const row = await file("me@example.com", entryLink(entryId), {
      purge: spy.purge,
    });

    expect(row).toMatchObject({
      holdState: "held",
      heldAt: NOW,
      hidAt: NOT_SET,
      alertedAt: NOT_SET,
      subjectId: entryId,
    });
    expect(await entryStatus(entryId)).toBe("removed");
    expect(spy.calls).toStrictEqual([]);
  });

  it("pins a kit it held under a copyright hold against a review's Approve", async () => {
    const entryId = await sharedEntry();
    await core()
      .update(outfitEntries)
      .set({ moderationStatus: "removed" })
      .where(eq(outfitEntries.id, entryId));
    await file("me@example.com", entryLink(entryId));
    // The hold's restore hands the kit to review, and a report's row is open.
    await core()
      .update(outfitEntries)
      .set({ moderationStatus: "hidden_pending_review" })
      .where(eq(outfitEntries.id, entryId));
    const queueId = newUlid();
    await core().insert(reviewQueue).values({
      id: queueId,
      subjectType: "entry",
      subjectId: entryId,
      source: "reports",
      status: "pending",
      createdAt: NOW,
      openedAt: NOW,
    });

    expect(await resolveReview(queueId, await makeUser(), "approve")).toBe(
      "resolved",
    );
    expect(await entryStatus(entryId)).toBe("hidden_pending_review");
  });

  it("records a hide for a kit a report already hid, which it pins", async () => {
    const entryId = await sharedEntry();
    await core()
      .update(outfitEntries)
      .set({ moderationStatus: "hidden_pending_review" })
      .where(eq(outfitEntries.id, entryId));
    await core().delete(notifications);

    const spy = purgeSpy();
    const row = await file("me@example.com", entryLink(entryId), {
      purge: spy.purge,
    });

    expect(row.heldAt).toBe(NOW);
    expect(row.hidAt).toBeNull();
    expect(row.alertedAt).toBeNull();
    // Nothing newly hidden, so nothing to purge.
    expect(spy.calls).toStrictEqual([]);
    // A report already told the author; the request does not again.
    expect(await core().select().from(notifications)).toStrictEqual([]);
  });
});

/**
 * A handle on the core database whose next batch first lets `before` run:
 * the moment between a confirm's reads and its batch.
 */
function landingFirst(before: () => Promise<unknown>) {
  const db = core();
  const batch = db.batch.bind(db);
  Reflect.set(
    db,
    "batch",
    async (...statements: Parameters<typeof db.batch>) => {
      await before();
      return batch(...statements);
    },
  );
  return db;
}

describe("a confirm that lands after a decision", () => {
  it("hides nothing and alerts no one once the request was declined", async () => {
    const { entryId, request } = await pastTheCap();
    const token = await confirmTokenFor(request.id);
    const before = await owedWhere(
      (email) => email.email.template.kind === "removal_requested",
    );

    await confirmTakedownRequest(
      landingFirst(() =>
        decideRemovalRequest(
          core(),
          "op-one",
          request.id,
          { outcome: "declined", reason: "Not what it says." },
          NOW + 30,
        ),
      ),
      token,
      { oweWhere: oweInCoreWhere, purge: noPurge },
      NOW + 60,
    );

    expect(await entryStatus(entryId)).toBe("ok");
    const [row] = await core()
      .select()
      .from(takedownRequests)
      .where(eq(takedownRequests.id, request.id));
    expect(row).toMatchObject({
      status: "declined",
      confirmedAt: NOT_SET,
      heldAt: NOT_SET,
    });
    expect(
      await owedWhere(
        (email) => email.email.template.kind === "removal_requested",
      ),
    ).toHaveLength(before.length);
  });
});

describe("Block and decline all, on a shared address", () => {
  it("declines only the requester's own, and still blocks the address", async () => {
    const a = await sharedEntry();
    const b = await sharedEntry();
    const theirs = await file("me@example.com", entryLink(a));
    const neighbour = await file("you@example.com", entryLink(b));
    expect(neighbour.ipKey).toBe(theirs.ipKey);

    expect(
      await blockAndDeclineAll(core(), "op-one", theirs.id, NOW + 10),
    ).toStrictEqual({ status: "blocked", declined: 1 });

    const [still] = await core()
      .select({ status: takedownRequests.status })
      .from(takedownRequests)
      .where(eq(takedownRequests.id, neighbour.id));
    expect(still?.status).toBe("pending");
    expect(await entryStatus(b)).toBe("hidden_pending_review");
    const later = await file(
      "someone@example.com",
      entryLink(await sharedEntry()),
    );
    expect(later.holdState).toBe("blocked");
  });
});

describe("what a filed request names", () => {
  it("reads a kit's link as the kit, even when its id is a photo's", async () => {
    const entryId = await sharedEntry();
    const photoId = newUlid();
    await core()
      .insert(entryPhotos)
      .values({
        id: photoId,
        entryId,
        photoKey: `entries/x/${entryId}/${photoId}.jpg`,
        position: 0,
        screenStatus: "pass",
      });

    const row = await file(
      "me@example.com",
      `https://dialed.run/kit/${photoId}`,
    );

    expect(await requestSubjectOf(core(), row)).toStrictEqual({
      subjectType: "entry",
      subjectId: photoId,
      entryId: photoId,
    });
  });
});

/**
The reads of one request's own row by its id, outside any batch.
*/
function readsById(statements: readonly string[]): string[] {
  return statements.filter((sql) =>
    /^select .* from "takedown_requests" where "takedown_requests"\."id" = \?/u.test(
      sql,
    ),
  );
}

function requestFor(email: string, location: string, key = newUlid()) {
  return {
    email,
    signature: "Sam Runner",
    location,
    description: "",
    isAttested: true as const,
    idempotencyKey: key,
    attempt: "token",
    remoteIp: "203.0.113.9",
    isLimited: false,
  };
}

describe("what a request reads back, and its receipt's words", () => {
  it("reads its row back to purge only for a link of ours", async () => {
    const elsewhereReads = await queriesDuring(() =>
      fileTakedownRequest(
        core(),
        requestFor("me@example.com", "https://elsewhere.example/x"),
        deps,
        NOW,
      ),
    );
    const ours = await sharedEntry();
    const oursReads = await queriesDuring(() =>
      fileTakedownRequest(
        core(),
        requestFor("you@example.com", entryLink(ours)),
        deps,
        NOW,
      ),
    );

    expect(readsById(elsewhereReads.statements)).toStrictEqual([]);
    expect(readsById(oursReads.statements)).toHaveLength(1);
  });

  it("answers a second confirm from the one read of its token", async () => {
    const { request } = await pastTheCap();
    const token = await confirmTokenFor(request.id);
    const effects = { oweWhere: oweInCoreWhere, purge: noPurge };
    await confirmTakedownRequest(core(), token, effects, NOW + 60);

    let answer = "";
    const { statements } = await queriesDuring(async () => {
      answer = await confirmTakedownRequest(core(), token, effects, NOW + 120);
    });

    expect(answer).toBe("confirmed");
    expect(statements).toHaveLength(1);
  });

  it("files once when the same request is sent twice at once", async () => {
    const entryId = await sharedEntry();
    const key = newUlid();

    const same = requestFor("me@example.com", entryLink(entryId), key);
    const answers = await Promise.all([
      fileTakedownRequest(core(), same, deps, NOW),
      fileTakedownRequest(core(), same, deps, NOW),
    ]);

    expect(answers).toStrictEqual([
      { status: "received" },
      { status: "received" },
    ]);
    expect(await core().select().from(takedownRequests)).toHaveLength(1);
  });

  it("tells a requester whose request hid something exactly that", async () => {
    const entryId = await sharedEntry();
    const row = await file("me@example.com", entryLink(entryId));

    const [receipt] = await owedWhere(
      (email) => email.dedupeKey === `removal_request_received:${row.id}`,
    );
    expect(receipt?.email.template).toStrictEqual({
      kind: "removal_request_received",
      dueAt: row.dueAt,
      isHidden: true,
    });
  });

  it("tells a requester who must confirm that nothing is hidden yet", async () => {
    const { request } = await pastTheCap();

    const [receipt] = await owedWhere(
      (email) => email.dedupeKey === `removal_request_received:${request.id}`,
    );
    expect(receipt?.email.template).toStrictEqual({
      kind: "removal_request_received",
      dueAt: request.dueAt,
      isHidden: false,
      confirmRequestId: request.id,
    });
  });
});

describe("the removal requests' purge count", () => {
  it("is kept under a key of its own, which no runner's id can be", () => {
    expect(REMOVAL_REQUESTS_PURGE_KEY).toMatch(/^[a-z-]+$/u);
    expect(ulidSchema.safeParse(REMOVAL_REQUESTS_PURGE_KEY).success).toBe(
      false,
    );
  });
});
