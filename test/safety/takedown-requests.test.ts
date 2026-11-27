import { desc, eq, inArray } from "drizzle-orm";
import { drizzle } from "drizzle-orm/d1";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { z } from "zod";

import { rateLimits, outbox, takedownRequests } from "../../src/db/schema-core";
import { env } from "../../src/env";
import { EMAIL_SENDS_PER_HOUR } from "../../src/lib/contracts/email";
import { newUlid } from "../../src/lib/ids";
import { readOutboxRow } from "../../src/lib/sql/outbox";
import { TAKEDOWN_RECEIPTS_PER_HOUR } from "../../src/modules/ops/limits/rate-limit";
import {
  fileTakedownRequest,
  pendingTakedownRequests,
} from "../../src/modules/safety/takedowns/takedown-requests";
import { queriesDuring } from "../d1-spy";
import { noPurge } from "../purge-spy";
import { oweInCoreWhere } from "../../src/modules/ops/outbox/owe-in-core";

/**
 * `/takedown`'s request (design 136, D-117): it hides what our link names
 * (round 35 #58e; `removal-decisions.test.ts` holds that), records the
 * request, and owes every operator an alert and the requester a receipt —
 * all in one batch.
 */
const NOW = 1_800_000_000;
const DUE = NOW + 48 * 60 * 60;
const ADMINS = env.ADMIN_USER_IDS;
const ENTRY = "01JABCDEFGHJKMNPQRSTVWXYZ0";

function core() {
  return drizzle(env.DIALED_CORE);
}

const pass = () => Promise.resolve({ ok: true });
const deps = { verify: pass, oweWhere: oweInCoreWhere, purge: noPurge };

function request(overrides: Record<string, unknown> = {}) {
  return {
    email: "Sam@Example.com",
    signature: "Sam Runner",
    location: `https://dialed.run/feed/entry/${ENTRY}`,
    description: "",
    isAttested: true as const,
    idempotencyKey: newUlid(),
    attempt: "token",
    remoteIp: "203.0.113.9",
    isLimited: false,
    ...overrides,
  };
}

/**
A request filed on a deployment that limits.
*/
function fileLimited(overrides: Record<string, unknown>, at = NOW) {
  return fileTakedownRequest(
    core(),
    request({ isLimited: true, ...overrides }),
    deps,
    at,
  );
}

async function rows() {
  return core().select().from(takedownRequests);
}

const emailPayload = z.object({
  dedupeKey: z.string(),
  email: z.object({ to: z.unknown(), template: z.unknown() }),
});

async function owedEmails() {
  const owed = await core()
    .select({ kind: outbox.kind, payload: outbox.payload })
    .from(outbox)
    // A receipt is `email`, an operator's alert `operator_email` (design 232).
    .where(inArray(outbox.kind, ["email", "operator_email"]))
    // The operators' alerts, then the receipt.
    .orderBy(desc(outbox.kind), outbox.dedupeKey);
  return owed.map((row) => {
    const read = readOutboxRow(row.kind, row.payload);
    if (!read.ok) throw new Error(read.problem);
    return emailPayload.parse(read.message.payload);
  });
}

beforeEach(async () => {
  await core().delete(takedownRequests);
  await core().delete(outbox);
  await core().delete(rateLimits);
  Reflect.set(env, "ADMIN_USER_IDS", "op-one,op-two");
});

afterEach(() => {
  if (ADMINS === undefined) Reflect.deleteProperty(env, "ADMIN_USER_IDS");
  else Reflect.set(env, "ADMIN_USER_IDS", ADMINS);
});

describe("filing a request", () => {
  it("records it with the subject our link names and 48 hours to decide", async () => {
    const input = request({ description: "a photo of me" });
    expect(await fileTakedownRequest(core(), input, deps, NOW)).toStrictEqual({
      status: "received",
    });
    const [row] = await rows();
    expect(row).toMatchObject({
      requesterEmail: "sam@example.com",
      signature: "Sam Runner",
      location: input.location,
      subjectType: "entry",
      subjectId: ENTRY,
      description: "a photo of me",
      status: "pending",
      dueAt: DUE,
      createdAt: NOW,
      idempotencyKey: input.idempotencyKey,
    });
    expect(row?.resolvedAt).toBeNull();
  });

  it("keeps a link that is not ours, with no subject, and no empty description", async () => {
    await fileTakedownRequest(
      core(),
      request({ location: "https://elsewhere.example/img" }),
      deps,
      NOW,
    );
    const [row] = await rows();
    expect(row?.subjectType).toBeNull();
    expect(row?.subjectId).toBeNull();
    expect(row?.description).toBeNull();
  });

  it("owes every operator an alert and the requester a receipt, in the same batch", async () => {
    await fileTakedownRequest(core(), request(), deps, NOW);
    const [row] = await rows();
    const id = row?.id ?? "";
    expect(await owedEmails()).toStrictEqual([
      {
        dedupeKey: `removal_requested:${id}:op-one`,
        email: {
          to: { userId: "op-one" },
          template: { kind: "removal_requested", dueAt: DUE, isOurs: true },
        },
      },
      {
        dedupeKey: `removal_requested:${id}:op-two`,
        email: {
          to: { userId: "op-two" },
          template: { kind: "removal_requested", dueAt: DUE, isOurs: true },
        },
      },
      {
        dedupeKey: `removal_request_received:${id}`,
        email: {
          to: { address: "sam@example.com" },
          template: {
            kind: "removal_request_received",
            dueAt: DUE,
            // `ENTRY` names no kit in this file's database, so the
            // request hid nothing (`removal-decisions.test.ts` hides one).
            isHidden: false,
            confirmRequestId: id,
            waits: false,
            about: { kind: "kit", entryId: ENTRY },
          },
        },
      },
    ]);
  });

  it("owes the operators' alerts as operator mail and the receipt as ordinary mail (design 232)", async () => {
    Reflect.set(env, "ADMIN_USER_IDS", "op-one");
    await fileTakedownRequest(core(), request(), deps, NOW);

    const kinds = await core()
      .select({ kind: outbox.kind, dedupeKey: outbox.dedupeKey })
      .from(outbox)
      .orderBy(outbox.dedupeKey);

    expect(
      kinds.map((row) => `${row.kind} ${row.dedupeKey.split(":", 1)[0] ?? ""}`),
    ).toStrictEqual([
      "email removal_request_received",
      "operator_email removal_requested",
    ]);
  });

  it("tells the operators when the link is not ours", async () => {
    Reflect.set(env, "ADMIN_USER_IDS", "op-one");
    await fileTakedownRequest(
      core(),
      request({ location: "somewhere else" }),
      deps,
      NOW,
    );
    const [alert, receipt] = await owedEmails();
    expect(alert?.email.template).toStrictEqual({
      kind: "removal_requested",
      dueAt: DUE,
      isOurs: false,
    });
    // Nothing was hidden, so the receipt does not say it was.
    expect(receipt?.email.template).toMatchObject({
      kind: "removal_request_received",
      dueAt: DUE,
      isHidden: false,
      waits: false,
      about: { kind: "elsewhere" },
    });
  });

  it("refuses a browser Turnstile refused, writing nothing", async () => {
    const result = await fileTakedownRequest(
      core(),
      request(),
      {
        verify: () => Promise.resolve({ ok: false }),
        oweWhere: oweInCoreWhere,
        purge: noPurge,
      },
      NOW,
    );
    expect(result).toStrictEqual({ status: "refused" });
    expect(await rows()).toStrictEqual([]);
    expect(await owedEmails()).toStrictEqual([]);
  });

  it("answers a repeat as the first request, writing and sending nothing again", async () => {
    const input = request();
    await fileTakedownRequest(core(), input, deps, NOW);
    const again = await fileTakedownRequest(
      core(),
      { ...input, email: "SAM@example.com", isLimited: true },
      deps,
      NOW + 5,
    );
    expect(again).toStrictEqual({ status: "received" });
    expect(await rows()).toHaveLength(1);
    expect(await owedEmails()).toHaveLength(3);
    expect(await core().select().from(rateLimits)).toStrictEqual([]);
  });
});

describe("the limit, on a real deployment", () => {
  it("lets a visitor send the hour's allowance and refuses the next, saying until when", async () => {
    for (let n = 0; n < EMAIL_SENDS_PER_HOUR; n += 1) {
      const email = `sam-${String(n)}@example.com`;
      expect(await fileLimited({ email })).toStrictEqual({
        status: "received",
      });
    }
    const refused = await fileTakedownRequest(
      core(),
      request({ isLimited: true, email: "someone-else@example.com" }),
      deps,
      NOW,
    );
    expect(refused).toStrictEqual({ status: "limited", until: NOW + 3600 });
    expect(await rows()).toHaveLength(EMAIL_SENDS_PER_HOUR);
  });

  it("counts every address in one IPv6 /64 as one visitor (SA-M11)", async () => {
    const results = [];
    for (let n = 0; n <= EMAIL_SENDS_PER_HOUR; n += 1) {
      const host = (n + 1).toString(16);
      results.push(
        await fileLimited({
          email: `sam-${String(n)}@example.com`,
          remoteIp: `2001:db8:1:2::${host}`,
        }),
      );
    }
    expect(results.at(-1)).toStrictEqual({
      status: "limited",
      until: NOW + 3600,
    });
    expect(await fileLimited({ remoteIp: "2001:db8:1:3::1" })).toStrictEqual({
      status: "received",
    });
  });

  it("sends one address at most TAKEDOWN_RECEIPTS_PER_HOUR receipts, whoever asks (SA-M11)", async () => {
    for (let n = 0; n < TAKEDOWN_RECEIPTS_PER_HOUR; n += 1) {
      const remoteIp = `203.0.113.${String(n)}`;
      expect(await fileLimited({ remoteIp })).toStrictEqual({
        status: "received",
      });
    }
    const owed = await owedEmails();
    expect(
      await fileLimited(
        { email: "SAM@example.com", remoteIp: "198.51.100.1" },
        NOW + 10,
      ),
    ).toStrictEqual({ status: "limited", until: NOW + 3600 });
    expect(await rows()).toHaveLength(TAKEDOWN_RECEIPTS_PER_HOUR);
    expect(await owedEmails()).toHaveLength(owed.length);
  });

  it("shares one allowance among every address that reaches one inbox", async () => {
    for (let n = 0; n < TAKEDOWN_RECEIPTS_PER_HOUR; n += 1) {
      await fileLimited({
        email: `sam+${String(n)}@example.com`,
        remoteIp: `203.0.113.${String(n)}`,
      });
    }
    expect(
      await fileLimited({
        email: "Sam+another@example.com",
        remoteIp: "198.51.100.1",
      }),
    ).toStrictEqual({ status: "limited", until: NOW + 3600 });
    const counted = await core()
      .select({ subject: rateLimits.subject })
      .from(rateLimits)
      .where(eq(rateLimits.kind, "takedown-to"));
    expect(counted.map((row) => row.subject)).toStrictEqual([
      "sam@example.com",
    ]);
  });

  it("does not count the address for a visitor already over their own limit", async () => {
    for (let n = 0; n <= EMAIL_SENDS_PER_HOUR; n += 1) {
      await fileLimited({ email: `sam-${String(n)}@example.com` });
    }
    const counted = await core()
      .select({ subject: rateLimits.subject })
      .from(rateLimits)
      .where(eq(rateLimits.kind, "takedown-to"));
    expect(counted).toHaveLength(EMAIL_SENDS_PER_HOUR);
    expect(counted.map((row) => row.subject)).not.toContain(
      `sam-${String(EMAIL_SENDS_PER_HOUR)}@example.com`,
    );
  });

  it("counts by visitor address, and an unknown one as one visitor", async () => {
    await fileTakedownRequest(
      core(),
      request({ isLimited: true, remoteIp: undefined }),
      deps,
      NOW,
    );
    const limits = await core()
      .select({ kind: rateLimits.kind, subject: rateLimits.subject })
      .from(rateLimits);
    expect(limits).toContainEqual({ kind: "takedown", subject: "unknown" });
  });

  it("is not counted off a real deployment", async () => {
    await fileTakedownRequest(core(), request(), deps, NOW);
    expect(await core().select().from(rateLimits)).toStrictEqual([]);
  });
});

describe("the open requests, as Review lists them", () => {
  it("lists the pending ones, soonest due first, with the clock and the kit", async () => {
    await fileTakedownRequest(core(), request(), deps, NOW + 60);
    await fileTakedownRequest(
      core(),
      request({ location: "words only", description: "my photo" }),
      deps,
      NOW,
    );
    // Decided before the third is filed, so the third is under the cap
    // and may act, as the other two may.
    const [done] = await core()
      .select({ id: takedownRequests.id })
      .from(takedownRequests)
      .where(eq(takedownRequests.createdAt, NOW + 60));
    await core()
      .update(takedownRequests)
      .set({ status: "declined" })
      .where(eq(takedownRequests.id, done?.id ?? ""));
    await fileTakedownRequest(core(), request(), deps, NOW - 10);

    const listed = await pendingTakedownRequests(core(), NOW + 3600);

    expect(listed.map((row) => row.createdAt)).toStrictEqual([NOW - 10, NOW]);
    expect(listed[0]).toMatchObject({
      requesterEmail: "sam@example.com",
      signature: "Sam Runner",
      description: undefined,
      subject: { subjectType: "entry", subjectId: ENTRY, entryId: ENTRY },
      dueAt: NOW - 10 + 48 * 3600,
      due: "Due in 47h",
      // D-117: our link names a runner, so their other photos are listed
      // — none here, since no kit stands behind this id.
      otherPhotos: { photos: [], total: 0, handle: undefined },
    });
    expect(listed[1]).toMatchObject({
      location: "words only",
      description: "my photo",
      subject: undefined,
      due: "Due in 47h",
      otherPhotos: undefined,
    });
  });

  it("stops at the limit it is given", async () => {
    await fileTakedownRequest(core(), request(), deps, NOW);
    await fileTakedownRequest(core(), request(), deps, NOW + 1);
    expect(await pendingTakedownRequests(core(), NOW, 1)).toHaveLength(1);
  });

  it("looks for no other photos or matches when no request names anything of ours", async () => {
    // A link that is not ours has no subject, and contributes nothing to
    // the subjects the two lookups take: with none, neither is asked.
    await fileTakedownRequest(
      core(),
      request({ location: "words only", description: "my photo" }),
      deps,
      NOW,
    );

    let listed: Awaited<ReturnType<typeof pendingTakedownRequests>> = [];
    const { statements } = await queriesDuring(async () => {
      listed = await pendingTakedownRequests(core(), NOW);
    });

    expect(listed.map((row) => row.subject)).toStrictEqual([undefined]);
    // `ranked` is the other-photos read's window; `fingerprint` is only
    // selected by the matches read's probe.
    expect(
      statements.filter((sql) => /"ranked"|"fingerprint"/u.test(sql)),
    ).toStrictEqual([]);
  });
});
