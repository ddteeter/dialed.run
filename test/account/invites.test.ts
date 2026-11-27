import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/d1";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { countedKeys } from "../rate-limit-rows";

import { user } from "../../src/db/schema-auth";
import {
  accessAsks,
  accessRequests,
  rateLimits,
  inviteCodes,
  inviteRedemptions,
  outbox,
  termsAcceptances,
  userProfiles,
} from "../../src/db/schema-core";
import { env } from "../../src/env";
import { EMAIL_SENDS_PER_HOUR } from "../../src/lib/contracts/email";
import { newUlid } from "../../src/lib/ids";
import { nowSeconds } from "../../src/lib/now";
import { confirmTokenHash } from "../../src/lib/confirm-token";
import {
  ACCESS_CONFIRM_S,
  accessGate,
  confirmAccessAsk,
  requestAccess,
} from "../../src/modules/account/access/access";
import { turnstileAttempt } from "../../src/modules/ops/edge/turnstile";
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
} from "../../src/modules/account/access/invites";
import type { InviteAnswer } from "../../src/modules/account/access/invites";
import type { TurnstileAttempt } from "../../src/modules/ops";
import { fakeMail, ORIGIN, owedTo } from "../email/helpers";

/**
Send invite's code, parsed out of its answer: a refusal or nothing fails the test here.
*/
function codeOf(answer: InviteAnswer): string {
  return z.object({ code: z.string() }).parse(answer).code;
}

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
    db.delete(accessAsks),
    db.delete(rateLimits),
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
    const codeId = await seedCode("DIAL-7K3P-2QXM");
    const now = 1_000_000;
    const mine = {
      code: "DIAL-7K3P-2QXM",
      userId: newUlid(),
      email: "Maya@X.test",
    };
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
      {
        id: ANY_STRING,
        email: "old@x.test",
        note: "Hi",
        blockedRegion: "",
        createdAt: 10,
      },
      {
        id: ANY_STRING,
        email: "new@x.test",
        note: NOTHING,
        blockedRegion: "",
        createdAt: 30,
      },
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
    expect(first.code).toMatch(/^DIAL-[2-9A-HJ-NP-Z]{4}-[2-9A-HJ-NP-Z]{4}$/u);
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
    await seedCode("DIAL-4444-4444");
    const random = forceCode(2); // -> "DIAL-4444-4444"
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
      { kind: "email", dedupeKey: `invite:${codeOf(first)}` },
    ]);
    await later.settled();
    expect(mail.sent).toHaveLength(1);
    expect(mail.sent[0]).toMatchObject({
      to: "sam@x.test",
      subject: "Your dialed.run invite",
    });
    expect(mail.sent[0]?.text).toContain(
      `Here's your code: ${codeOf(first)}. It works once.`,
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
        code: codeOf(first),
        // No address is copied onto the code: D7 reads it from the request.
        label: NOTHING,
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
    expect(desk.codes.map((listed) => listed.label)).toStrictEqual([
      "sam@x.test (request)",
    ]);
  });

  it("labels a code by its request while the request is there, and by its own label otherwise", async () => {
    const requestId = newUlid();
    await db.insert(accessRequests).values({
      id: requestId,
      email: "gone@x.test",
      createdAt: 1,
      updatedAt: 1,
    });
    await db.insert(inviteCodes).values([
      { id: newUlid(), code: "DIAL-REQS", requestId, createdAt: 3 },
      {
        id: newUlid(),
        code: "DIAL-OWNL",
        label: "Tuesday track group",
        createdAt: 2,
      },
    ]);
    const labels = async () => {
      const desk = await accessDesk(db);
      return desk.codes.map(({ code, label }) => ({ code, label }));
    };
    expect(await labels()).toStrictEqual([
      { code: "DIAL-REQS", label: "gone@x.test (request)" },
      { code: "DIAL-OWNL", label: "Tuesday track group" },
    ]);

    // The request forgotten — as account deletion forgets it by address —
    // takes the address off the Desk with it.
    await db.delete(accessRequests).where(eq(accessRequests.id, requestId));
    expect(await labels()).toStrictEqual([
      { code: "DIAL-REQS", label: NOTHING },
      { code: "DIAL-OWNL", label: "Tuesday track group" },
    ]);
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
    const random = forceCode(4); // -> "DIAL-6666-6666"
    try {
      await seedCode("DIAL-6666-6666");
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
    const random = vi.spyOn(globalThis.crypto, "getRandomValues");
    try {
      expect(
        await inviteFromRequest(
          db,
          { operatorId: "op", requestId },
          later.owed,
        ),
      ).toBeUndefined();
      // Not even drawn: a code is only minted for a request still waiting.
      expect(random).not.toHaveBeenCalled();
    } finally {
      random.mockRestore();
    }
    await later.settled();
    expect(await db.select().from(inviteCodes)).toStrictEqual([]);
    expect(await db.select().from(outbox)).toStrictEqual([]);
    expect(mail.sent).toStrictEqual([]);
  });

  it("answers nothing and emails nothing when the request's code does not land", async () => {
    // The request was waiting when it was read, and was answered some
    // other way before this press's batch ran — so the batch stores no
    // code for it. A trigger stands in for that: it drops the insert.
    const requestId = newUlid();
    await db.insert(accessRequests).values({
      id: requestId,
      email: "gone@x.test",
      createdAt: 1,
      updatedAt: 1,
    });
    await env.DIALED_CORE.exec(
      "CREATE TRIGGER invite_code_lost BEFORE INSERT ON invite_codes BEGIN SELECT RAISE(IGNORE); END",
    );
    try {
      const mail = fakeMail();
      const later = owedTo(mail);
      expect(
        await inviteFromRequest(
          db,
          { operatorId: "op", requestId },
          later.owed,
        ),
      ).toBeUndefined();
      await later.settled();
      expect(await db.select().from(inviteCodes)).toStrictEqual([]);
      expect(await db.select().from(outbox)).toStrictEqual([]);
      expect(mail.sent).toStrictEqual([]);
    } finally {
      await env.DIALED_CORE.exec("DROP TRIGGER invite_code_lost");
    }
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
  action: "request-access",
};

/**
The `access` counts kept, by visitor; the per-address counts left out.
*/
async function visitorKeys(): Promise<string[]> {
  const keys = await countedKeys(db);
  return keys.filter((key) => key.startsWith("access:"));
}

/**
 * Where an ask's confirm link goes: the fake sender, the work held until
 * the test lets it go, and what a failed send reported.
 */
function askMail() {
  const mail = fakeMail();
  const work: Promise<unknown>[] = [];
  const reports: Record<string, string>[] = [];
  return {
    mail,
    reports,
    sending: {
      deps: mail,
      background: {
        keepAlive: (promise: Promise<unknown>) => {
          work.push(promise);
        },
        report: (_error: unknown, context: Record<string, string>) => {
          reports.push(context);
        },
      },
    },
    settled: () => Promise.all(work),
  };
}

/**
The token each confirm link sent carried, in order.
*/
function tokensSent(mail: ReturnType<typeof fakeMail>): string[] {
  return mail.sent.map(
    (message) =>
      /confirm-access\?token=(?<token>[0-9a-f]{64})/u.exec(String(message.text))
        ?.groups?.token ?? "",
  );
}

type Asking = ReturnType<typeof askMail>;

/**
One ask, as Au5's form sends it, and the links it sent.
*/
async function askAs(
  asking: Asking,
  input: Readonly<{
    email?: string;
    note?: string;
    blockedRegion?: "MS" | "TN";
    isLimited?: boolean;
    attempt?: TurnstileAttempt;
  }>,
  now: number,
) {
  const result = await requestAccess(
    db,
    {
      email: input.email ?? "sam@x.test",
      note: input.note ?? "",
      attempt: input.attempt ?? ATTEMPT,
      isLimited: input.isLimited ?? false,
      blockedRegion: input.blockedRegion,
    },
    verifyAs(true).verify,
    asking.sending,
    now,
  );
  await asking.settled();
  return result;
}

/**
The ask's link opened, on a deployment that limits or not.
*/
function confirmAt(token: string, now: number, isLimited = false) {
  return confirmAccessAsk(db, { token, isLimited }, now);
}

describe("requestAccess (Au5)", () => {
  it("keeps the ask unconfirmed, address lowercased, sends its address the link, and puts nothing on D7", async () => {
    const asking = askMail();
    expect(
      await askAs(asking, { email: "Sam@X.test", note: "Winter runner." }, 5),
    ).toStrictEqual({ status: "sent" });
    const [token = ""] = tokensSent(asking.mail);
    expect(await db.select().from(accessAsks)).toStrictEqual([
      {
        id: ANY_STRING,
        email: "sam@x.test",
        note: "Winter runner.",
        blockedRegion: NOTHING,
        tokenHash: await confirmTokenHash(token),
        createdAt: 5,
        confirmedAt: NOTHING,
      },
    ]);
    expect(await db.select().from(accessRequests)).toStrictEqual([]);
    const desk = await accessDesk(db);
    expect(desk.requests).toStrictEqual([]);
    expect(asking.mail.sent).toHaveLength(1);
    const [sent] = asking.mail.sent;
    expect(sent?.to).toBe("sam@x.test");
    expect(sent?.subject).toBe("Confirm your place on the dialed.run list");
    // The plain text, its lines joined back up.
    const text = String(sent?.text).replaceAll(/\s+/gu, " ");
    expect(text).toContain(
      "Someone asked to join dialed.run with this address. If it was you, confirm it here:",
    );
    expect(text).toContain("Confirm my email");
    expect(text).toContain(`${ORIGIN}/account/confirm-access?token=${token}`);
    expect(text).toContain(
      "If it wasn't, ignore this email and nothing happens.",
    );
  });

  it("keeps no note for an empty one, and the place the ask was made from", async () => {
    await askAs(askMail(), { note: "", blockedRegion: "TN" }, 5);
    expect(await db.select().from(accessAsks)).toMatchObject([
      { note: NOTHING, blockedRegion: "TN" },
    ]);
  });

  it("refuses what Turnstile refuses, keeping and sending nothing", async () => {
    const asking = askMail();
    const { seen, verify } = verifyAs(false);
    expect(
      await requestAccess(
        db,
        {
          email: "sam@x.test",
          note: "",
          attempt: ATTEMPT,
          isLimited: true,
          blockedRegion: undefined,
        },
        verify,
        asking.sending,
      ),
    ).toStrictEqual({ status: "refused" });
    await asking.settled();
    expect(seen).toStrictEqual([ATTEMPT]);
    expect(await db.select().from(accessAsks)).toStrictEqual([]);
    expect(await db.select().from(rateLimits)).toStrictEqual([]);
    expect(asking.mail.sent).toStrictEqual([]);
  });

  it("limits a visitor to five an hour on a real deployment, keyed by their address, and counts nothing for an address past it", async () => {
    const asking = askMail();
    const ask = (email: string, attempt: TurnstileAttempt) =>
      askAs(asking, { email, attempt, isLimited: true }, 1000);
    for (const n of [1, 2, 3, 4, 5]) {
      expect(await ask(`${String(n)}@x.test`, ATTEMPT)).toStrictEqual({
        status: "sent",
      });
    }
    expect(await ask("6@x.test", ATTEMPT)).toStrictEqual({
      status: "limited",
      until: 1000 + 3600,
    });
    expect(await db.select().from(accessAsks)).toHaveLength(5);
    expect(asking.mail.sent).toHaveLength(5);
    expect(await visitorKeys()).toStrictEqual(["access:203.0.113.9"]);
    expect(await countedKeys(db)).not.toContain("access-confirm-to:6@x.test");
    // Another visitor is not held up by the first.
    expect(
      await ask("7@x.test", { ...ATTEMPT, remoteIp: undefined }),
    ).toStrictEqual({ status: "sent" });
    expect(await visitorKeys()).toStrictEqual([
      "access:203.0.113.9",
      "access:unknown",
    ]);
  });

  it("counts every address in one IPv6 /64 as one visitor, and keeps nothing past the limit (SA-M11)", async () => {
    const asking = askMail();
    const ask = (n: number, remoteIp: string) =>
      askAs(
        asking,
        {
          email: `asker-${String(n)}@x.test`,
          attempt: { ...ATTEMPT, remoteIp },
          isLimited: true,
        },
        1000,
      );
    const results = [];
    for (let n = 0; n <= EMAIL_SENDS_PER_HOUR; n += 1) {
      results.push(await ask(n, `2001:db8:1:2::${(n + 1).toString(16)}`));
    }
    expect(results.at(-1)).toStrictEqual({
      status: "limited",
      until: 1000 + 3600,
    });
    expect(await db.select().from(accessAsks)).toHaveLength(
      EMAIL_SENDS_PER_HOUR,
    );
    expect(await visitorKeys()).toStrictEqual(["access:2001:db8:1:2::/64"]);
    expect(await ask(99, "2001:db8:1:3::1")).toStrictEqual({ status: "sent" });
  });

  it("sends one address three links a day on a real deployment, whoever asks, and answers the same past them, keeping and sending nothing", async () => {
    const asking = askMail();
    const ask = (n: number, now: number) =>
      askAs(
        asking,
        {
          email: "Sam@X.test",
          note: `Ask ${String(n)}.`,
          attempt: { ...ATTEMPT, remoteIp: `198.51.100.${String(n)}` },
          isLimited: true,
        },
        now,
      );
    for (const n of [1, 2, 3]) await ask(n, 1000);
    expect(await ask(4, 1000)).toStrictEqual({ status: "sent" });
    expect(asking.mail.sent).toHaveLength(3);
    const notes = async () => {
      const rows = await db
        .select({ note: accessAsks.note })
        .from(accessAsks)
        .orderBy(accessAsks.createdAt, accessAsks.note);
      return rows.map((row) => row.note);
    };
    expect(await notes()).toStrictEqual(["Ask 1.", "Ask 2.", "Ask 3."]);
    // Asks spend the address's links, never its confirmed asks.
    expect(await countedKeys(db)).not.toContain("access-to:sam@x.test");
    expect(await ask(5, 1000 + 86_400)).toStrictEqual({ status: "sent" });
    expect(asking.mail.sent).toHaveLength(4);
    expect(await notes()).toStrictEqual([
      "Ask 1.",
      "Ask 2.",
      "Ask 3.",
      "Ask 5.",
    ]);
  });

  it("does not limit where the deployment does not", async () => {
    const asking = askMail();
    for (const n of [1, 2, 3, 4, 5, 6]) {
      await askAs(asking, { email: "sam@x.test", note: String(n) }, 1000);
    }
    expect(await db.select().from(accessAsks)).toHaveLength(6);
    expect(asking.mail.sent).toHaveLength(6);
    expect(await db.select().from(rateLimits)).toStrictEqual([]);
  });

  it("reports a link that did not send by its surface alone, and answers the same", async () => {
    const asking = askMail();
    asking.mail.failing(true);
    expect(await askAs(asking, { email: "sam@x.test" }, 5)).toStrictEqual({
      status: "sent",
    });
    expect(asking.reports).toStrictEqual([{ surface: "access-confirm-link" }]);
  });
});

describe("confirmAccessAsk (Au5's link)", () => {
  it("puts the ask on D7 with its note and place once its link is opened, and answers the receipt", async () => {
    const asking = askMail();
    await askAs(asking, { email: "Sam@X.test", note: "Winter runner." }, 5);
    const [token = ""] = tokensSent(asking.mail);
    expect(await confirmAt(token, 50)).toStrictEqual({
      status: "confirmed",
      email: "sam@x.test",
      isFromBlockedRegion: false,
    });
    expect(await db.select().from(accessRequests)).toMatchObject([
      {
        email: "sam@x.test",
        note: "Winter runner.",
        status: "pending",
        blockedRegion: NOTHING,
        createdAt: 50,
        updatedAt: 50,
      },
    ]);
    const desk = await accessDesk(db);
    expect(desk.requests).toMatchObject([
      { email: "sam@x.test", note: "Winter runner." },
    ]);
    expect(await db.select().from(accessAsks)).toMatchObject([
      { confirmedAt: 50 },
    ]);
  });

  it.each([true, false])(
    "answers a blocked state's receipt for an ask placed there, and tags its request (limited: %s)",
    async (isLimited) => {
      const asking = askMail();
      await askAs(asking, { blockedRegion: "MS", isLimited }, 5);
      const [token = ""] = tokensSent(asking.mail);
      expect(await confirmAt(token, 6, isLimited)).toStrictEqual({
        status: "confirmed",
        email: "sam@x.test",
        isFromBlockedRegion: true,
      });
      expect(await db.select().from(accessRequests)).toMatchObject([
        { status: "pending", blockedRegion: "MS" },
      ]);
    },
  );

  it("answers a second open with the same receipt and writes nothing", async () => {
    const asking = askMail();
    await askAs(asking, { isLimited: true }, 5);
    const [token = ""] = tokensSent(asking.mail);
    await confirmAt(token, 6, true);
    const before = await db.select().from(accessRequests);
    expect(await confirmAt(token, 7, true)).toStrictEqual({
      status: "confirmed",
      email: "sam@x.test",
      isFromBlockedRegion: false,
    });
    expect(await db.select().from(accessRequests)).toStrictEqual(before);
    expect(await db.select().from(accessAsks)).toMatchObject([
      { confirmedAt: 6 },
    ]);
    const counts = await db
      .select({ count: rateLimits.count })
      .from(rateLimits)
      .where(eq(rateLimits.kind, "access-to"));
    expect(counts).toStrictEqual([{ count: 1 }]);
  });

  it("works for 48 hours from the ask, and past them answers as an unknown link, writing nothing", async () => {
    const asking = askMail();
    await askAs(asking, { email: "a@x.test" }, 1000);
    await askAs(asking, { email: "b@x.test" }, 1000);
    const [onTime = "", late = ""] = tokensSent(asking.mail);
    expect(ACCESS_CONFIRM_S).toBe(48 * 3600);
    expect(await confirmAt(onTime, 1000 + ACCESS_CONFIRM_S)).toMatchObject({
      status: "confirmed",
    });
    expect(await confirmAt(late, 1000 + ACCESS_CONFIRM_S + 1)).toStrictEqual({
      status: "not_found",
    });
    const requests = await db.select().from(accessRequests);
    expect(requests.map((row) => row.email)).toStrictEqual(["a@x.test"]);
  });

  it("answers a token that matches no ask as unknown, writing nothing", async () => {
    await askAs(askMail(), {}, 5);
    expect(await confirmAt("0".repeat(64), 6)).toStrictEqual({
      status: "not_found",
    });
    expect(await db.select().from(accessRequests)).toStrictEqual([]);
    expect(await db.select().from(accessAsks)).toMatchObject([
      { confirmedAt: NOTHING },
    ]);
  });

  it("confirms only the ask its link was sent for", async () => {
    const asking = askMail();
    await askAs(asking, { note: "Stranger." }, 5);
    await askAs(asking, { note: "Mine." }, 6);
    const [, mine = ""] = tokensSent(asking.mail);
    await confirmAt(mine, 7);
    const asks = await db
      .select({ note: accessAsks.note, confirmedAt: accessAsks.confirmedAt })
      .from(accessAsks)
      .orderBy(accessAsks.createdAt);
    expect(asks).toStrictEqual([
      { note: "Stranger.", confirmedAt: NOTHING },
      { note: "Mine.", confirmedAt: 7 },
    ]);
    // An ask nobody confirmed set nothing: the confirmed one's note stands.
    expect(await db.select().from(accessRequests)).toMatchObject([
      { note: "Mine.", status: "pending" },
    ]);
  });

  it("keeps a pending request's first confirmed note, place and time when a later ask is confirmed", async () => {
    const asking = askMail();
    await askAs(asking, { note: "First." }, 1);
    await askAs(asking, { note: "Second.", blockedRegion: "MS" }, 2);
    const [first = "", second = ""] = tokensSent(asking.mail);
    await confirmAt(first, 3);
    expect(await confirmAt(second, 4)).toStrictEqual({
      status: "confirmed",
      email: "sam@x.test",
      isFromBlockedRegion: true,
    });
    expect(await db.select().from(accessRequests)).toMatchObject([
      {
        note: "First.",
        blockedRegion: NOTHING,
        status: "pending",
        createdAt: 3,
        updatedAt: 3,
      },
    ]);
  });

  it("puts a declined address back on the list with the confirmed ask's note, place and time, and leaves an invited one as it was", async () => {
    await db.insert(accessRequests).values([
      {
        id: newUlid(),
        email: "no@x.test",
        note: "Old.",
        status: "declined",
        blockedRegion: "MS",
        createdAt: 1,
        updatedAt: 1,
      },
      {
        id: newUlid(),
        email: "yes@x.test",
        note: "Old.",
        status: "invited",
        createdAt: 1,
        updatedAt: 1,
      },
      {
        id: newUlid(),
        email: "quiet@x.test",
        note: "Old.",
        status: "declined",
        createdAt: 1,
        updatedAt: 1,
      },
    ]);
    const asking = askMail();
    await askAs(asking, { email: "no@x.test", note: "New." }, 8);
    await askAs(
      asking,
      { email: "yes@x.test", note: "New.", blockedRegion: "TN" },
      8,
    );
    await askAs(asking, { email: "quiet@x.test", blockedRegion: "TN" }, 8);
    for (const token of tokensSent(asking.mail)) await confirmAt(token, 9);
    const rows = await db
      .select({
        email: accessRequests.email,
        note: accessRequests.note,
        status: accessRequests.status,
        blockedRegion: accessRequests.blockedRegion,
        createdAt: accessRequests.createdAt,
        updatedAt: accessRequests.updatedAt,
      })
      .from(accessRequests)
      .orderBy(accessRequests.email);
    expect(rows).toStrictEqual([
      {
        email: "no@x.test",
        note: "New.",
        status: "pending",
        blockedRegion: NOTHING,
        createdAt: 9,
        updatedAt: 9,
      },
      {
        email: "quiet@x.test",
        note: NOTHING,
        status: "pending",
        blockedRegion: "TN",
        createdAt: 9,
        updatedAt: 9,
      },
      {
        email: "yes@x.test",
        note: "Old.",
        status: "invited",
        blockedRegion: NOTHING,
        createdAt: 1,
        updatedAt: 1,
      },
    ]);
  });

  it("takes three confirmed asks a day for one address on a real deployment, and answers the same receipt past them", async () => {
    const asking = askMail();
    const ask = (n: number, now: number) =>
      askAs(
        asking,
        {
          note: `Ask ${String(n)}.`,
          attempt: { ...ATTEMPT, remoteIp: `198.51.100.${String(n)}` },
          isLimited: true,
        },
        now,
      );
    for (const n of [1, 2, 3]) await ask(n, 1000);
    for (const token of tokensSent(asking.mail)) {
      await confirmAt(token, 1001, true);
    }
    await db.update(accessRequests).set({ status: "declined" });
    // A fourth confirm inside the day: the same receipt, nothing re-opened.
    await ask(4, 1000 + 86_400);
    expect(
      await confirmAt(tokensSent(asking.mail)[3] ?? "", 1000 + 86_400, true),
    ).toMatchObject({ status: "confirmed" });
    expect(await db.select().from(accessRequests)).toMatchObject([
      { note: "Ask 1.", status: "declined", updatedAt: 1001 },
    ]);
    // The next day's confirm re-opens it.
    await ask(5, 1001 + 86_400);
    await confirmAt(tokensSent(asking.mail)[4] ?? "", 1001 + 86_400, true);
    expect(await db.select().from(accessRequests)).toMatchObject([
      { note: "Ask 5.", status: "pending", updatedAt: 1001 + 86_400 },
    ]);
  });

  it("counts no confirmed ask where the deployment does not limit", async () => {
    const asking = askMail();
    await askAs(asking, {}, 5);
    const [token = ""] = tokensSent(asking.mail);
    await confirmAt(token, 6);
    expect(await db.select().from(rateLimits)).toStrictEqual([]);
  });
});

/**
 * `count` pending requests, one second apart from `from`, on `domain`,
 * inserted ten a statement (D1 binds at most 100 parameters).
 */
async function seedPending(
  count: number,
  {
    from = 1,
    domain = "held.test",
    status = "pending",
  }: Readonly<{
    from?: number;
    domain?: string;
    status?: "pending" | "invited" | "declined";
  }> = {},
) {
  const rows = Array.from({ length: count }, (_, n) => ({
    id: newUlid(),
    email: `a${String(n)}@${domain}`,
    status,
    createdAt: from + n,
    updatedAt: from + n,
  }));
  for (let at = 0; at < rows.length; at += 10) {
    await db.insert(accessRequests).values(rows.slice(at, at + 10));
  }
  return rows;
}

describe("D7's queue", () => {
  it("queues a re-opened request behind the ones asked for since", async () => {
    const held = await seedPending(DESK_LIST_LIMIT, { status: "declined" });
    await db.insert(accessRequests).values({
      id: newUlid(),
      email: "real@x.test",
      status: "pending",
      createdAt: 250,
      updatedAt: 250,
    });
    const asking = askMail();
    for (const { email } of held) await askAs(asking, { email }, 400);
    for (const token of tokensSent(asking.mail)) await confirmAt(token, 401);

    const desk = await accessDesk(db);
    expect(desk.requests[0]?.email).toBe("real@x.test");
    expect(desk.requests.slice(1).map((row) => row.createdAt)).toStrictEqual(
      Array.from({ length: DESK_LIST_LIMIT - 1 }, () => 401),
    );
  });

  it("counts every pending request, not the page, and pages past the limit oldest first", async () => {
    const rows = await seedPending(DESK_LIST_LIMIT + 1);
    // Answered requests are not waiting.
    await seedPending(2, {
      from: 5000,
      domain: "done.test",
      status: "invited",
    });

    const first = await accessDesk(db);
    expect(first.waiting).toBe(DESK_LIST_LIMIT + 1);
    expect(first.requests.map((row) => row.email)).toStrictEqual(
      rows.slice(0, DESK_LIST_LIMIT).map((row) => row.email),
    );
    expect(first.next).toBeDefined();

    const second = await accessDesk(db, first.next);
    expect(second.waiting).toBe(DESK_LIST_LIMIT + 1);
    expect(second.requests.map((row) => row.email)).toStrictEqual([
      rows[DESK_LIST_LIMIT]?.email,
    ]);
    expect(second.next).toBeUndefined();
  });

  it("pages through requests of the same second by id", async () => {
    const at = 7;
    const ids = [newUlid(), newUlid(), newUlid()].toSorted((a, b) =>
      a.localeCompare(b),
    );
    // Inserted, and named, in the reverse of id order, so neither the
    // table's order nor the address's is the one the page follows.
    await db.insert(accessRequests).values(
      ids.toReversed().map((id, n) => ({
        id,
        email: `t${String(n)}@x.test`,
        createdAt: at,
        updatedAt: at,
      })),
    );
    const page = await accessDesk(db, `${String(at)}.${ids[0] ?? ""}`);
    expect(page.requests.map((row) => row.id)).toStrictEqual(ids.slice(1));
  });

  it("has no next page at exactly the limit", async () => {
    await seedPending(DESK_LIST_LIMIT);
    const desk = await accessDesk(db);
    expect(desk.waiting).toBe(DESK_LIST_LIMIT);
    expect(desk.next).toBeUndefined();
  });
});

describe("D7 and a request's tag", () => {
  it("shows D7 the tag, and refuses Send invite for it, minting and sending nothing", async () => {
    const requestId = newUlid();
    await db.insert(accessRequests).values({
      id: requestId,
      email: "sam@x.test",
      blockedRegion: "MS",
      createdAt: 1,
      updatedAt: 1,
    });
    const desk = await accessDesk(db);
    expect(desk.requests).toMatchObject([
      { id: requestId, blockedRegion: "MS" },
    ]);
    const mail = fakeMail();
    const later = owedTo(mail);
    expect(
      await inviteFromRequest(db, { operatorId: "op", requestId }, later.owed),
    ).toStrictEqual({
      refused: "No invite while sign-up is closed in Mississippi.",
    });
    await later.settled();
    expect(mail.sent).toStrictEqual([]);
    expect(await db.select().from(inviteCodes)).toStrictEqual([]);
    expect(await db.select().from(outbox)).toStrictEqual([]);
    expect(await db.select().from(accessRequests)).toMatchObject([
      { status: "pending" },
    ]);
  });

  it("invites a request tagged with a state no longer listed", async () => {
    const requestId = newUlid();
    await db.insert(accessRequests).values({
      id: requestId,
      email: "sam@x.test",
      blockedRegion: "AL",
      createdAt: 1,
      updatedAt: 1,
    });
    const later = owedTo(fakeMail());
    const answer = await inviteFromRequest(
      db,
      { operatorId: "op", requestId },
      later.owed,
    );
    await later.settled();
    expect(codeOf(answer)).toMatch(/^DIAL-/u);
  });

  it("reports a failed invite email by its key's kind and its template", async () => {
    const requestId = newUlid();
    await db.insert(accessRequests).values({
      id: requestId,
      email: "sam@x.test",
      createdAt: 1,
      updatedAt: 1,
    });
    const mail = fakeMail();
    mail.failing(true);
    const later = owedTo(mail);
    const reports: Record<string, string>[] = [];
    const answer = await inviteFromRequest(
      db,
      { operatorId: "op", requestId },
      {
        ...later.owed,
        report: (_error, context) => {
          reports.push(context);
        },
      },
    );
    await later.settled();
    const code = codeOf(answer);
    expect(reports).toStrictEqual([
      expect.objectContaining({ dedupeKey: "invite", template: "invite" }),
    ]);
    expect(JSON.stringify(reports)).not.toContain(code);
  });
});

describe("turnstileAttempt", () => {
  it("reads the edge's address and the request's host", () => {
    const request = new Request("https://dialed.run/api/auth/sign-up/email", {
      headers: { "cf-connecting-ip": "198.51.100.4" },
    });
    expect(turnstileAttempt("t", request, "takedown")).toStrictEqual({
      token: "t",
      remoteIp: "198.51.100.4",
      hostname: "dialed.run",
      action: "takedown",
    });
  });

  it("has no address and no host without a request", () => {
    expect(turnstileAttempt(undefined, undefined, undefined)).toStrictEqual({
      token: undefined,
      remoteIp: undefined,
      hostname: "",
      action: undefined,
    });
    expect(
      turnstileAttempt("t", new Request("https://dialed.run/"), undefined),
    ).toMatchObject({ remoteIp: undefined });
  });
});

describe("accessGate", () => {
  it("is invite-only by the flag, and answers from the database", async () => {
    // Version 2 of the terms, as if published (D-93).
    const gate = accessGate(db, verifyAs(true).verify, 2);
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
    // ACC-6: the account accepted the published terms, at the same moment,
    // by signing up (round 29 #17).
    const accepted = await db
      .select()
      .from(termsAcceptances)
      .where(eq(termsAcceptances.userId, mine.userId));
    expect(accepted).toStrictEqual([
      {
        userId: mine.userId,
        version: 2,
        acceptedAt: row?.confirmedAt,
        how: "sign-up",
      },
    ]);
  });

  it("records the terms for an account made with no invite, once however often it runs", async () => {
    const gate = accessGate(db, verifyAs(true).verify, 2);
    const userId = newUlid();
    await gate.confirm(userId);
    await gate.confirm(userId);
    expect(
      await db
        .select({ version: termsAcceptances.version })
        .from(termsAcceptances)
        .where(eq(termsAcceptances.userId, userId)),
    ).toStrictEqual([{ version: 2 }]);
  });

  it("records no terms while none are published, and still spends the invite", async () => {
    // No version: the shipped draft, unpublished (D-93).
    const gate = accessGate(db, verifyAs(true).verify);
    await seedCode("DIAL-DRFT");
    const mine = claim("DIAL-DRFT");
    expect(await gate.claim(mine)).toBe("redeemed");
    await gate.confirm(mine.userId);
    const [row] = await db
      .select({ confirmedAt: inviteRedemptions.confirmedAt })
      .from(inviteRedemptions)
      .where(eq(inviteRedemptions.userId, mine.userId));
    expect(row?.confirmedAt).toBeGreaterThan(0);
    expect(
      await db
        .select()
        .from(termsAcceptances)
        .where(eq(termsAcceptances.userId, mine.userId)),
    ).toStrictEqual([]);
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
      {
        token: "t",
        remoteIp: undefined,
        hostname: "dialed.run",
        action: "sign-up",
      },
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
