import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/d1";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { z } from "zod";

import {
  emailSendLimits,
  outbox,
  takedownRequests,
} from "../../src/db/schema-core";
import { env } from "../../src/env";
import { EMAIL_SENDS_PER_HOUR } from "../../src/lib/contracts/email";
import { newUlid } from "../../src/lib/ids";
import { readOutboxRow } from "../../src/lib/sql/outbox";
import {
  fileTakedownRequest,
  pendingTakedownRequests,
} from "../../src/modules/safety";
import { oweInCore } from "../queue-fakes";

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
const deps = { verify: pass, owe: oweInCore };

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

async function rows() {
  return core().select().from(takedownRequests);
}

const emailPayload = z.object({
  dedupeKey: z.string(),
  email: z.object({ to: z.unknown(), template: z.unknown() }),
});

async function owedEmails() {
  const owed = await core()
    .select({ payload: outbox.payload })
    .from(outbox)
    .where(eq(outbox.kind, "email"));
  return owed.map((row) => {
    const read = readOutboxRow("email", row.payload);
    if (!read.ok) throw new Error(read.problem);
    return emailPayload.parse(read.message.payload);
  });
}

beforeEach(async () => {
  await core().delete(takedownRequests);
  await core().delete(outbox);
  await core().delete(emailSendLimits);
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
            isOurs: true,
          },
        },
      },
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
    expect(receipt?.email.template).toStrictEqual({
      kind: "removal_request_received",
      dueAt: DUE,
      isOurs: false,
    });
  });

  it("refuses a browser Turnstile refused, writing nothing", async () => {
    const result = await fileTakedownRequest(
      core(),
      request(),
      { verify: () => Promise.resolve({ ok: false }), owe: oweInCore },
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
    expect(await core().select().from(emailSendLimits)).toStrictEqual([]);
  });
});

describe("the limit, on a real deployment", () => {
  it("lets a visitor send the hour's allowance and refuses the next, saying until when", async () => {
    for (let n = 0; n < EMAIL_SENDS_PER_HOUR; n += 1) {
      expect(
        await fileTakedownRequest(
          core(),
          request({ isLimited: true }),
          deps,
          NOW,
        ),
      ).toStrictEqual({ status: "received" });
    }
    const refused = await fileTakedownRequest(
      core(),
      request({ isLimited: true }),
      deps,
      NOW,
    );
    expect(refused).toStrictEqual({ status: "limited", until: NOW + 3600 });
    expect(await rows()).toHaveLength(EMAIL_SENDS_PER_HOUR);
  });

  it("counts by visitor address, and an unknown one as one visitor", async () => {
    await fileTakedownRequest(
      core(),
      request({ isLimited: true, remoteIp: undefined }),
      deps,
      NOW,
    );
    const [limit] = await core().select().from(emailSendLimits);
    expect(limit?.key).toBe("takedown:unknown");
  });

  it("is not counted off a real deployment", async () => {
    await fileTakedownRequest(core(), request(), deps, NOW);
    expect(await core().select().from(emailSendLimits)).toStrictEqual([]);
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
    await fileTakedownRequest(core(), request(), deps, NOW - 10);
    const filed = await core()
      .select({ id: takedownRequests.id })
      .from(takedownRequests)
      .orderBy(takedownRequests.createdAt);
    const done = filed[2];
    await core()
      .update(takedownRequests)
      .set({ status: "declined" })
      .where(eq(takedownRequests.id, done?.id ?? ""));

    const listed = await pendingTakedownRequests(core(), NOW + 3600);

    expect(listed.map((row) => row.createdAt)).toStrictEqual([NOW - 10, NOW]);
    expect(listed[0]).toMatchObject({
      requesterEmail: "sam@example.com",
      signature: "Sam Runner",
      description: undefined,
      subject: { subjectType: "entry", subjectId: ENTRY, entryId: ENTRY },
      dueAt: NOW - 10 + 48 * 3600,
      due: "Due in 47h",
    });
    expect(listed[1]).toMatchObject({
      location: "words only",
      description: "my photo",
      subject: undefined,
      due: "Due in 47h",
    });
  });

  it("stops at the limit it is given", async () => {
    await fileTakedownRequest(core(), request(), deps, NOW);
    await fileTakedownRequest(core(), request(), deps, NOW + 1);
    expect(await pendingTakedownRequests(core(), NOW, 1)).toHaveLength(1);
  });
});
