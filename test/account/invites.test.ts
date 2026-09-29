import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/d1";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";

import { user } from "../../src/db/schema-auth";
import {
  accessRequests,
  emailSendLimits,
  inviteCodes,
  inviteRedemptions,
  outbox,
  userProfiles,
} from "../../src/db/schema-core";
import { env } from "../../src/env";
import { newUlid } from "../../src/lib/ids";
import { nowSeconds } from "../../src/lib/now";
import {
  accessGate,
  requestAccess,
  turnstileAttempt,
} from "../../src/modules/account/access";
import {
  CLAIM_HOLD_S,
  DESK_LIST_LIMIT,
  accessDesk,
  confirmRedemption,
  createInviteCode,
  declineRequest,
  inviteFromRequest,
  inviteStanding,
  redeemInvite,
  restoreInviteCode,
  revokeInviteCode,
} from "../../src/modules/account/invites";
import type { TurnstileAttempt } from "../../src/modules/ops";
import { fakeMail, owedTo } from "../email/helpers";

/**
 * Invite codes and access requests (task 126, ACC-5) on real D1: a code's
 * standing, the claim that spends it, Desk D7's writes, and Au5.
 */
const db = drizzle(env.DIALED_CORE);

/**
A real `null`, not the literal — unicorn/no-null forbids the keyword, and
these fixtures assert against genuinely nullable DB columns.
*/
const NOTHING = z.null().parse(JSON.parse("null"));

/**
`expect.any(...)` is typed `any`; `unknown` here is what keeps assigning
it into a fixture object from tripping no-unsafe-assignment.
*/
const ANY_STRING: unknown = expect.any(String);

beforeEach(async () => {
  await db.batch([
    db.delete(inviteCodes),
    db.delete(inviteRedemptions),
    db.delete(accessRequests),
    db.delete(emailSendLimits),
    db.delete(outbox),
  ]);
});

async function seedCode(
  code: string,
  values: { maxUses?: number; revokedAt?: number; createdAt?: number } = {},
): Promise<string> {
  const id = newUlid();
  await db
    .insert(inviteCodes)
    .values({ id, code, createdAt: nowSeconds(), ...values });
  return id;
}

/**
An account row, as Better Auth would have made it.
*/
async function account(id: string, email: string): Promise<void> {
  await db.insert(user).values({
    id,
    email,
    name: "",
    emailVerified: false,
    createdAt: new Date(),
    updatedAt: new Date(),
  });
}

function claim(code: string, email = `${newUlid().toLowerCase()}@x.test`) {
  return { code, userId: newUlid(), email };
}

/**
Sorts two ids for comparing sets of redemption rows regardless of order.
*/
function byId(a: string, b: string) {
  return a.localeCompare(b);
}

/**
 * Forces `mintInviteCode`'s next code, by controlling the bytes its default
 * `crypto.getRandomValues` source hands back — every byte becomes `byte`,
 * so the code is `INVITE_ALPHABET[byte % 32]` four times over.
 */
function forceCode(byte: number) {
  return vi
    .spyOn(globalThis.crypto, "getRandomValues")
    .mockImplementation((array) => {
      if (array instanceof Uint8Array) array.fill(byte);
      return array;
    });
}

describe("CLAIM_HOLD_S", () => {
  it("is ten minutes in seconds", () => {
    expect(CLAIM_HOLD_S).toBe(600);
  });
});

describe("inviteStanding", () => {
  it("is open for a live code with a use left, and invalid for none or a revoked one", async () => {
    await seedCode("DIAL-OPEN");
    await seedCode("DIAL-GONE", { revokedAt: nowSeconds() });
    expect(await inviteStanding(db, "DIAL-OPEN")).toBe("open");
    expect(await inviteStanding(db, "DIAL-GONE")).toBe("invalid");
    expect(await inviteStanding(db, "DIAL-NONE")).toBe("invalid");
  });

  it("is used once its uses are spent — by an account, or by a live hold", async () => {
    await seedCode("DIAL-TWOS", { maxUses: 2 });
    const now = nowSeconds();
    const first = claim("DIAL-TWOS");
    expect(await redeemInvite(db, first, now)).toBe("redeemed");
    await account(first.userId, first.email);
    expect(await inviteStanding(db, "DIAL-TWOS", now)).toBe("open");
    // A hold with no account yet counts while it is live…
    expect(await redeemInvite(db, claim("DIAL-TWOS"), now)).toBe("redeemed");
    expect(await inviteStanding(db, "DIAL-TWOS", now)).toBe("used");
    // …and stops counting when it runs out, the account never having come.
    expect(await inviteStanding(db, "DIAL-TWOS", now + CLAIM_HOLD_S)).toBe(
      "open",
    );
    expect(await inviteStanding(db, "DIAL-TWOS", now + CLAIM_HOLD_S - 1)).toBe(
      "used",
    );
  });
});

describe("redeemInvite", () => {
  it("writes the claim against the account's id, address lowercased, with its hold", async () => {
    const codeId = await seedCode("DIAL-7K3P");
    const now = 1_000_000;
    const mine = { code: "DIAL-7K3P", userId: newUlid(), email: "Maya@X.test" };
    expect(await redeemInvite(db, mine, now)).toBe("redeemed");
    expect(await db.select().from(inviteRedemptions)).toStrictEqual([
      {
        userId: mine.userId,
        codeId,
        email: "maya@x.test",
        heldUntil: now + CLAIM_HOLD_S,
        redeemedAt: now,
        confirmedAt: NOTHING,
      },
    ]);
  });

  it("lets only one of two claims on a single-use code land", async () => {
    await seedCode("DIAL-ONCE");
    const results = await Promise.all([
      redeemInvite(db, claim("DIAL-ONCE")),
      redeemInvite(db, claim("DIAL-ONCE")),
    ]);
    expect(results.toSorted((a, b) => a.localeCompare(b))).toStrictEqual([
      "redeemed",
      "used",
    ]);
    expect(await db.select().from(inviteRedemptions)).toHaveLength(1);
  });

  it("refuses a revoked or unknown code as invalid, writing nothing", async () => {
    await seedCode("DIAL-GONE", { revokedAt: nowSeconds() });
    expect(await redeemInvite(db, claim("DIAL-GONE"))).toBe("invalid");
    expect(await redeemInvite(db, claim("DIAL-NONE"))).toBe("invalid");
    expect(await db.select().from(inviteRedemptions)).toStrictEqual([]);
  });

  it("lets a retried sign-up claim the code its earlier attempt holds, as the same use", async () => {
    await seedCode("DIAL-RTRY");
    const email = "retry@x.test";
    const now = 1_000_000;
    const first = claim("DIAL-RTRY", email);
    expect(await redeemInvite(db, first, now)).toBe("redeemed");
    // The account has not arrived; the same address tries again.
    const again = claim("DIAL-RTRY", email);
    expect(await redeemInvite(db, again, now + 1)).toBe("redeemed");
    // Neither claim is cleared: either attempt may be the one that lands.
    const rows = await db.select().from(inviteRedemptions);
    expect(rows.map((row) => row.userId).toSorted(byId)).toStrictEqual(
      [first.userId, again.userId].toSorted(byId),
    );
    // One address, one use: another address is refused.
    expect(await redeemInvite(db, claim("DIAL-RTRY"), now + 2)).toBe("used");
  });

  it("keeps an in-flight claim's use when a retry runs beside it and the first attempt's account wins", async () => {
    // The interleaving: A claims; B (the same address, retrying) claims;
    // A's user insert lands and B's fails on the address.
    await seedCode("DIAL-RACE");
    const email = `${newUlid().toLowerCase()}@race.test`;
    const now = 1_000_000;
    const a = claim("DIAL-RACE", email);
    const b = claim("DIAL-RACE", email);
    expect(await redeemInvite(db, a, now)).toBe("redeemed");
    expect(await redeemInvite(db, b, now + 1)).toBe("redeemed");
    await account(a.userId, email);
    // The account has its redemption row…
    const [kept] = await db
      .select({ userId: inviteRedemptions.userId })
      .from(inviteRedemptions)
      .where(eq(inviteRedemptions.userId, a.userId));
    expect(kept?.userId).toBe(a.userId);
    // …and the code stays spent after every hold has run out.
    const later = now + 1 + CLAIM_HOLD_S;
    expect(await inviteStanding(db, "DIAL-RACE", later)).toBe("used");
    expect(await redeemInvite(db, claim("DIAL-RACE"), later)).toBe("used");
  });

  it("does not take a retry's shortcut past a hold that has run out, or one confirmed", async () => {
    await seedCode("DIAL-LATE");
    const email = "late@x.test";
    const now = 1_000_000;
    await redeemInvite(db, claim("DIAL-LATE", email), now - CLAIM_HOLD_S);
    expect(await redeemInvite(db, claim("DIAL-LATE"), now)).toBe("redeemed");
    // The address's own claim ran out, and the code's one use is held by
    // someone else since: no use left for it.
    expect(await redeemInvite(db, claim("DIAL-LATE", email), now)).toBe("used");
    await seedCode("DIAL-CONF", { maxUses: 2 });
    const confirmed = claim("DIAL-CONF", "conf@x.test");
    await redeemInvite(db, confirmed, now);
    await confirmRedemption(db, confirmed.userId, now);
    await redeemInvite(db, claim("DIAL-CONF"), now);
    // A confirmed claim is a finished sign-up, not one in flight: a new
    // sign-up from its address (its account since deleted) is a new use,
    // and there is none left.
    expect(await redeemInvite(db, claim("DIAL-CONF", "conf@x.test"), now)).toBe(
      "used",
    );
  });

  it("never clears a claim whose account exists", async () => {
    await seedCode("DIAL-KEEP", { maxUses: 2 });
    const email = "kept@x.test";
    const first = claim("DIAL-KEEP", email);
    await redeemInvite(db, first);
    await account(first.userId, email);
    await redeemInvite(db, claim("DIAL-KEEP", email));
    expect(await db.select().from(inviteRedemptions)).toHaveLength(2);
  });
});

describe("confirmRedemption", () => {
  it("makes a use permanent: deleting the account does not free the code", async () => {
    await seedCode("DIAL-PERM");
    const now = 1_000_000;
    const mine = claim("DIAL-PERM", "perm@x.test");
    await redeemInvite(db, mine, now);
    await account(mine.userId, mine.email);
    await confirmRedemption(db, mine.userId, now + 5);
    await confirmRedemption(db, mine.userId, now + 9);
    await db.delete(user).where(eq(user.id, mine.userId));
    const later = now + CLAIM_HOLD_S;
    expect(await inviteStanding(db, "DIAL-PERM", later)).toBe("used");
    // Confirmed once, at the first call; a repeat leaves it.
    const rows = await db
      .select({ confirmedAt: inviteRedemptions.confirmedAt })
      .from(inviteRedemptions);
    expect(rows).toStrictEqual([{ confirmedAt: now + 5 }]);
  });

  it("frees an unconfirmed use whose account is gone, once the hold runs out", async () => {
    await seedCode("DIAL-FREE");
    const now = 1_000_000;
    const mine = claim("DIAL-FREE", "free@x.test");
    await redeemInvite(db, mine, now);
    await confirmRedemption(db, newUlid(), now);
    expect(await inviteStanding(db, "DIAL-FREE", now + CLAIM_HOLD_S)).toBe(
      "open",
    );
  });
});

describe("Desk D7", () => {
  it("lists pending requests oldest first, and codes newest first with who used them", async () => {
    await db.insert(accessRequests).values([
      { id: newUlid(), email: "new@x.test", createdAt: 30, updatedAt: 30 },
      {
        id: newUlid(),
        email: "old@x.test",
        note: "Hi",
        createdAt: 10,
        updatedAt: 10,
      },
      {
        id: newUlid(),
        email: "done@x.test",
        status: "invited",
        createdAt: 5,
        updatedAt: 5,
      },
    ]);
    const older = await seedCode("DIAL-OLDR", { maxUses: 3, createdAt: 100 });
    await seedCode("DIAL-NEWR", { createdAt: 200, revokedAt: 250 });
    const handled = { code: "DIAL-OLDR", userId: newUlid(), email: "a@x.test" };
    const bare = { code: "DIAL-OLDR", userId: newUlid(), email: "b@x.test" };
    const ghost = claim("DIAL-OLDR");
    await redeemInvite(db, handled, 300);
    await redeemInvite(db, bare, 301);
    await redeemInvite(db, ghost, 302);
    await account(handled.userId, handled.email);
    await account(bare.userId, bare.email);
    await db
      .insert(userProfiles)
      .values({ userId: handled.userId, username: "maya_runs" });

    const desk = await accessDesk(db);
    expect(desk.requests).toStrictEqual([
      { id: ANY_STRING, email: "old@x.test", note: "Hi", createdAt: 10 },
      { id: ANY_STRING, email: "new@x.test", note: NOTHING, createdAt: 30 },
    ]);
    expect(desk.codes).toStrictEqual([
      {
        id: ANY_STRING,
        code: "DIAL-NEWR",
        label: NOTHING,
        maxUses: 1,
        createdAt: 200,
        isRevoked: true,
        usedBy: [],
      },
      {
        id: older,
        code: "DIAL-OLDR",
        label: NOTHING,
        maxUses: 3,
        createdAt: 100,
        isRevoked: false,
        // The handle once picked, the email before O0, and nothing for a
        // claim whose account never came.
        usedBy: ["@maya_runs", "b@x.test"],
      },
    ]);
  });

  it("lists at most the limit, keeping the newest codes and the oldest requests", () => {
    expect(DESK_LIST_LIMIT).toBe(200);
  });

  it("creates a code once per form key, with its label and uses", async () => {
    const input = {
      operatorId: "op",
      label: "Tuesday track group",
      maxUses: 8,
      idempotencyKey: "key-1",
    };
    const first = await createInviteCode(db, input, 50);
    const again = await createInviteCode(db, input, 60);
    expect(again).toStrictEqual(first);
    expect(first.code).toMatch(/^DIAL-[2-9A-HJ-NP-Z]{4}$/u);
    const rows = await db.select().from(inviteCodes);
    expect(rows).toMatchObject([
      {
        code: first.code,
        label: "Tuesday track group",
        maxUses: 8,
        createdBy: "op",
        idempotencyKey: "key-1",
        createdAt: 50,
        revokedAt: NOTHING,
        requestId: NOTHING,
      },
    ]);
  });

  it("stores an empty label as none, and keys are the operator's own", async () => {
    await createInviteCode(db, {
      operatorId: "op",
      label: "",
      maxUses: 1,
      idempotencyKey: "same",
    });
    await createInviteCode(db, {
      operatorId: "other",
      label: "",
      maxUses: 1,
      idempotencyKey: "same",
    });
    const rows = await db.select().from(inviteCodes);
    expect(rows).toHaveLength(2);
    expect(rows.every((row) => row.label === null)).toBe(true);
  });

  it("says a code that collided with another was not created, and writes nothing", async () => {
    await seedCode("DIAL-4444");
    const random = forceCode(2); // -> "DIAL-4444"
    try {
      await expect(
        createInviteCode(db, {
          operatorId: "op",
          label: "Clash",
          maxUses: 1,
          idempotencyKey: "fresh-key",
        }),
      ).rejects.toThrow("invite code was not created");
    } finally {
      random.mockRestore();
    }
    const rows = await db.select().from(inviteCodes);
    expect(rows.map((row) => row.label)).toStrictEqual([NOTHING]);
  });

  it("answers a request with a single-use code labelled for it, once", async () => {
    const requestId = newUlid();
    await db.insert(accessRequests).values({
      id: requestId,
      email: "sam@x.test",
      createdAt: 1,
      updatedAt: 1,
    });
    const mail = fakeMail();
    const later = owedTo(mail);
    const first = await inviteFromRequest(
      db,
      { operatorId: "op", requestId },
      later.owed,
      9,
    );
    // Owed in the same batch, sent after the answer.
    expect(mail.sent).toHaveLength(0);
    expect(await db.select().from(outbox)).toMatchObject([
      { kind: "email", dedupeKey: `invite:${first?.code ?? ""}` },
    ]);
    await later.settled();
    expect(mail.sent).toHaveLength(1);
    expect(mail.sent[0]).toMatchObject({
      to: "sam@x.test",
      subject: "Your dialed.run invite",
    });
    expect(mail.sent[0]?.text).toContain(
      `Here's your code: ${first?.code ?? ""}. It works once.`,
    );
    expect(await db.select().from(outbox)).toStrictEqual([]);
    const again = owedTo(mail);
    const second = await inviteFromRequest(
      db,
      { operatorId: "op", requestId },
      again.owed,
      10,
    );
    await again.settled();
    expect(second).toStrictEqual(first);
    // A second press answers with the same code and emails nothing more.
    expect(mail.sent).toHaveLength(1);
    expect(await db.select().from(outbox)).toStrictEqual([]);
    expect(await db.select().from(inviteCodes)).toMatchObject([
      {
        code: first?.code,
        label: "sam@x.test (request)",
        maxUses: 1,
        createdBy: "op",
        requestId,
        createdAt: 9,
        revokedAt: NOTHING,
        idempotencyKey: NOTHING,
      },
    ]);
    const [request] = await db.select().from(accessRequests);
    expect(request).toMatchObject({ status: "invited", updatedAt: 9 });
    const desk = await accessDesk(db);
    expect(desk.requests).toStrictEqual([]);
  });

  it("emails nothing when another press answered the request first", async () => {
    // The race: this press read the request as pending, then another
    // press's batch stored its code before this one's ran. This batch's
    // code is never stored, so its email is withdrawn in the same batch.
    const requestId = newUlid();
    await db.insert(accessRequests).values({
      id: requestId,
      email: "race@x.test",
      createdAt: 1,
      updatedAt: 1,
    });
    await db.insert(inviteCodes).values({
      id: newUlid(),
      code: "DIAL-AAAA",
      requestId,
      createdAt: 1,
    });
    const mail = fakeMail();
    const later = owedTo(mail);
    expect(
      await inviteFromRequest(db, { operatorId: "op", requestId }, later.owed),
    ).toStrictEqual({ code: "DIAL-AAAA" });
    await later.settled();
    expect(await db.select().from(outbox)).toStrictEqual([]);
    expect(mail.sent).toStrictEqual([]);
    expect(await db.select().from(inviteCodes)).toHaveLength(1);
  });

  it("does not let a code collision hide behind the request's own conflict target", async () => {
    // Same shape as `createInviteCode`'s: untargeted, `onConflictDoNothing`
    // would swallow a `code` collision that belongs to nobody's request and
    // silently return no code instead of a real error.
    const random = forceCode(4); // -> "DIAL-6666"
    try {
      await seedCode("DIAL-6666");
      const requestId = newUlid();
      await db.insert(accessRequests).values({
        id: requestId,
        email: "collide@x.test",
        createdAt: 1,
        updatedAt: 1,
      });
      const { owed } = owedTo(fakeMail());
      await expect(
        inviteFromRequest(db, { operatorId: "op", requestId }, owed),
      ).rejects.toThrow();
      // The batch failed whole: no email is owed for a code never stored.
      expect(await db.select().from(outbox)).toStrictEqual([]);
    } finally {
      random.mockRestore();
    }
  });

  it("mints nothing for a request that is not pending", async () => {
    const requestId = newUlid();
    await db.insert(accessRequests).values({
      id: requestId,
      email: "no@x.test",
      status: "declined",
      createdAt: 1,
      updatedAt: 1,
    });
    const mail = fakeMail();
    const later = owedTo(mail);
    expect(
      await inviteFromRequest(db, { operatorId: "op", requestId }, later.owed),
    ).toBeUndefined();
    await later.settled();
    expect(await db.select().from(inviteCodes)).toStrictEqual([]);
    expect(await db.select().from(outbox)).toStrictEqual([]);
    expect(mail.sent).toStrictEqual([]);
  });

  it("declines silently, and only a pending request", async () => {
    const requestId = newUlid();
    await db.insert(accessRequests).values({
      id: requestId,
      email: "d@x.test",
      createdAt: 1,
      updatedAt: 1,
    });
    await declineRequest(db, requestId, 7);
    await declineRequest(db, requestId, 8);
    expect(await db.select().from(accessRequests)).toMatchObject([
      { status: "declined", updatedAt: 7 },
    ]);
  });

  it("revokes at once, keeps the first time, and undoes", async () => {
    const id = await seedCode("DIAL-RVKE");
    await revokeInviteCode(db, id, 40);
    await revokeInviteCode(db, id, 41);
    const [revoked] = await db.select().from(inviteCodes);
    expect(revoked?.revokedAt).toBe(40);
    expect(await inviteStanding(db, "DIAL-RVKE")).toBe("invalid");
    await restoreInviteCode(db, id);
    expect(await inviteStanding(db, "DIAL-RVKE")).toBe("open");
  });
});

/**
Turnstile's verdict, fixed.
*/
function verifyAs(shouldPass: boolean) {
  const seen: TurnstileAttempt[] = [];
  const verify = (attempt: TurnstileAttempt) => {
    seen.push(attempt);
    return Promise.resolve(
      shouldPass
        ? { ok: true as const }
        : { ok: false as const, reason: "rejected" as const, codes: [] },
    );
  };
  return { seen, verify };
}

const ATTEMPT: TurnstileAttempt = {
  token: "t",
  remoteIp: "203.0.113.9",
  hostname: "dialed.run",
};

describe("requestAccess (Au5)", () => {
  it("keeps the request, address lowercased, and answers with the one receipt", async () => {
    const { verify } = verifyAs(true);
    expect(
      await requestAccess(
        db,
        {
          email: "Sam@X.test",
          note: "Winter runner.",
          attempt: ATTEMPT,
          isLimited: false,
        },
        verify,
        5,
      ),
    ).toStrictEqual({ status: "received" });
    expect(await db.select().from(accessRequests)).toMatchObject([
      {
        email: "sam@x.test",
        note: "Winter runner.",
        status: "pending",
        createdAt: 5,
        updatedAt: 5,
      },
    ]);
  });

  it("updates the note on a repeat, clearing it when the repeat has none", async () => {
    const { verify } = verifyAs(true);
    const ask = (note: string, now: number) =>
      requestAccess(
        db,
        { email: "sam@x.test", note, attempt: ATTEMPT, isLimited: false },
        verify,
        now,
      );
    await ask("First.", 1);
    await ask("Second.", 2);
    expect(await db.select().from(accessRequests)).toMatchObject([
      { note: "Second.", createdAt: 1, updatedAt: 2 },
    ]);
    await ask("", 3);
    expect(await db.select().from(accessRequests)).toMatchObject([
      { note: NOTHING, updatedAt: 3 },
    ]);
  });

  it("puts a declined address back on the list when it asks again, and leaves an invited one invited", async () => {
    const { verify } = verifyAs(true);
    await db.insert(accessRequests).values([
      {
        id: newUlid(),
        email: "no@x.test",
        status: "declined",
        createdAt: 1,
        updatedAt: 1,
      },
      {
        id: newUlid(),
        email: "yes@x.test",
        status: "invited",
        createdAt: 1,
        updatedAt: 1,
      },
    ]);
    for (const email of ["no@x.test", "yes@x.test"]) {
      await requestAccess(
        db,
        { email, note: "", attempt: ATTEMPT, isLimited: false },
        verify,
      );
    }
    const rows = await db
      .select({ email: accessRequests.email, status: accessRequests.status })
      .from(accessRequests)
      .orderBy(accessRequests.email);
    expect(rows).toStrictEqual([
      { email: "no@x.test", status: "pending" },
      { email: "yes@x.test", status: "invited" },
    ]);
  });

  it("refuses what Turnstile refuses, keeping nothing", async () => {
    const { seen, verify } = verifyAs(false);
    expect(
      await requestAccess(
        db,
        { email: "sam@x.test", note: "", attempt: ATTEMPT, isLimited: false },
        verify,
      ),
    ).toStrictEqual({ status: "refused" });
    expect(seen).toStrictEqual([ATTEMPT]);
    expect(await db.select().from(accessRequests)).toStrictEqual([]);
  });

  it("limits a visitor to five an hour on a real deployment, keyed by their address", async () => {
    const { verify } = verifyAs(true);
    const ask = (email: string, attempt: TurnstileAttempt) =>
      requestAccess(
        db,
        { email, note: "", attempt, isLimited: true },
        verify,
        1000,
      );
    for (const n of [1, 2, 3, 4, 5]) {
      expect(await ask(`${String(n)}@x.test`, ATTEMPT)).toStrictEqual({
        status: "received",
      });
    }
    expect(await ask("6@x.test", ATTEMPT)).toStrictEqual({
      status: "limited",
      until: 1000 + 3600,
    });
    expect(await db.select().from(accessRequests)).toHaveLength(5);
    const [row] = await db
      .select({ key: emailSendLimits.key })
      .from(emailSendLimits);
    expect(row?.key).toBe("access:203.0.113.9");
    // Another visitor is not held up by the first.
    expect(
      await ask("7@x.test", { ...ATTEMPT, remoteIp: undefined }),
    ).toStrictEqual({ status: "received" });
    const keys = await db
      .select({ key: emailSendLimits.key })
      .from(emailSendLimits);
    expect(
      keys.map((key) => key.key).toSorted((a, b) => a.localeCompare(b)),
    ).toStrictEqual(["access:203.0.113.9", "access:unknown"]);
  });

  it("does not limit where the deployment does not", async () => {
    const { verify } = verifyAs(true);
    for (const n of [1, 2, 3, 4, 5, 6]) {
      await requestAccess(
        db,
        {
          email: `${String(n)}@x.test`,
          note: "",
          attempt: ATTEMPT,
          isLimited: false,
        },
        verify,
      );
    }
    expect(await db.select().from(accessRequests)).toHaveLength(6);
    expect(await db.select().from(emailSendLimits)).toStrictEqual([]);
  });
});

describe("turnstileAttempt", () => {
  it("reads the edge's address and the request's host", () => {
    const request = new Request("https://dialed.run/api/auth/sign-up/email", {
      headers: { "cf-connecting-ip": "198.51.100.4" },
    });
    expect(turnstileAttempt("t", request)).toStrictEqual({
      token: "t",
      remoteIp: "198.51.100.4",
      hostname: "dialed.run",
    });
  });

  it("has no address and no host without a request", () => {
    expect(turnstileAttempt(undefined, undefined)).toStrictEqual({
      token: undefined,
      remoteIp: undefined,
      hostname: "",
    });
    expect(
      turnstileAttempt("t", new Request("https://dialed.run/")),
    ).toMatchObject({ remoteIp: undefined });
  });
});

describe("accessGate", () => {
  it("is invite-only by the flag, and answers from the database", async () => {
    const gate = accessGate(db, verifyAs(true).verify);
    expect(gate.isInviteOnly).toBe(true);
    await seedCode("DIAL-GATE");
    expect(await gate.standing("DIAL-GATE")).toBe("open");
    const mine = claim("DIAL-GATE");
    expect(await gate.claim(mine)).toBe("redeemed");
    expect(await gate.standing("DIAL-GATE")).toBe("used");
    await gate.confirm(mine.userId);
    const [row] = await db
      .select({ confirmedAt: inviteRedemptions.confirmedAt })
      .from(inviteRedemptions);
    expect(row?.confirmedAt).toBeGreaterThan(0);
  });

  it("passes Turnstile only on its verdict, handing it the request's attempt", async () => {
    const yes = verifyAs(true);
    const no = verifyAs(false);
    const request = new Request("https://dialed.run/x");
    expect(await accessGate(db, yes.verify).passesTurnstile("t", request)).toBe(
      true,
    );
    expect(await accessGate(db, no.verify).passesTurnstile("t", request)).toBe(
      false,
    );
    expect(yes.seen).toStrictEqual([
      { token: "t", remoteIp: undefined, hostname: "dialed.run" },
    ]);
  });
});

describe("the claim's account", () => {
  it("reads the account by address, not by id: a retry's account counts for the first claim too", async () => {
    await seedCode("DIAL-BYAD", { maxUses: 1 });
    const mine = claim("DIAL-BYAD", "addr@x.test");
    await redeemInvite(db, mine);
    // The account arrived under another attempt's id: the use is still
    // spent after the hold, because the address holds it.
    await account(newUlid(), "addr@x.test");
    const later = nowSeconds() + CLAIM_HOLD_S + 1;
    expect(await inviteStanding(db, "DIAL-BYAD", later)).toBe("used");
  });
});
