import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { countedKeys } from "../rate-limit-rows";

import { session, user, verification } from "../../src/db/schema-auth";
import { env } from "../../src/env";
import { EMAIL_SENDS_PER_HOUR } from "../../src/lib/contracts/email";
import { newUlid } from "../../src/lib/ids";
import { RESENDS_PER_VISITOR_PER_HOUR } from "../../src/modules/ops/limits/rate-limit";
import {
  rateLimits,
  emailVerifications,
  outbox,
} from "../../src/db/schema-core";
import { authMail } from "../../src/modules/account";
import {
  EMAIL_LINK_TTL_S,
  issueEmailLink,
  readEmailLink,
} from "../../src/modules/account/verification/email-links";
import {
  confirmEmail,
  confirmLinkUrl,
  readEmailLanding,
  requestEmailChange,
  resendConfirmation,
  type Background,
  type EmailChangeRequest,
} from "../../src/modules/account/verification/verification";
import {
  core,
  fakeMail,
  ORIGIN,
  owedTo,
  quiet,
  seedUser,
} from "../email/helpers";

/**
 * Confirming and changing an address (ACC-3, ACC-8; round 26 #11) on real
 * D1: one live link per runner and purpose, spent once, run out after a
 * day, and replaced by the next; the same answer whoever asks.
 */

const db = core();
const NOW = 1_800_000_000;

beforeEach(async () => {
  await db.batch([
    db.delete(emailVerifications),
    db.delete(rateLimits),
    db.delete(outbox),
  ]);
});

/**
The token a sent email's button carries.
*/
function tokenIn(message: EmailMessageBuilder | undefined): string {
  const href = /href="([^"]+)"/u.exec(message?.html ?? "")?.[1] ?? "";
  return new URL(href.replaceAll("&amp;", "&")).searchParams.get("token") ?? "";
}

async function emailOf(userId: string): Promise<{
  email: string;
  isVerified: boolean;
}> {
  const [row] = await db
    .select({ email: user.email, isVerified: user.emailVerified })
    .from(user)
    .where(eq(user.id, userId));
  return row ?? { email: "", isVerified: false };
}

describe("email links", () => {
  it("are single use, and read back only with their own secret", async () => {
    const { userId, email } = await seedUser({ isVerified: false });
    const token = await issueEmailLink(
      db,
      { userId, purpose: "verify", email },
      NOW,
    );
    expect(token.startsWith(`verify.${userId}.`)).toBe(true);
    // Only the hash is stored, and it is what the read carries.
    const [row] = await db.select().from(emailVerifications);
    expect(row?.tokenHash).not.toContain(token.split(".", 3)[2] ?? "");
    expect(await readEmailLink(db, token)).toStrictEqual({
      userId,
      purpose: "verify",
      email,
      expiresAt: NOW + EMAIL_LINK_TTL_S,
      usedAt: undefined,
      tokenHash: row?.tokenHash,
    });
    expect(EMAIL_LINK_TTL_S).toBe(86_400);

    for (const bad of [
      `${token}x`,
      token.replace("verify.", "change."),
      `${token}.extra`,
      token.split(".").slice(0, 2).join("."),
      "",
      42,
    ]) {
      expect(await readEmailLink(db, bad), String(bad)).toBeUndefined();
    }
  });

  it("encodes its secret URL-safe: no +, / or = survive the transform", async () => {
    // A deterministic 32 bytes, chosen so the raw base64 carries a '+', a
    // '/' and the padding '=' every 32-byte secret has (32 mod 3 == 2, so
    // there is always exactly one) — the three characters the URL-safe
    // transform must remove or replace. The expected value is computed here
    // independently of `toBase64Url`, so a broken replacement in production
    // shows up as a mismatch rather than being masked by both sides sharing
    // one (possibly buggy) transform.
    const bytes = new Uint8Array(32).fill(0xff);
    bytes[0] = 0xfb;
    const raw = btoa(String.fromCodePoint(...bytes));
    expect(raw).toContain("+");
    expect(raw).toContain("/");
    expect(raw.endsWith("=")).toBe(true);
    const expected = raw
      .replaceAll("+", "-")
      .replaceAll("/", "_")
      .replaceAll("=", "");

    // Seeded first: the account's id is itself random.
    const { userId } = await seedUser({ isVerified: false });
    const getRandomValues = vi
      .spyOn(crypto, "getRandomValues")
      .mockImplementation((array) => {
        if (array instanceof Uint8Array) array.set(bytes);
        return array;
      });
    try {
      const token = await issueEmailLink(
        db,
        { userId, purpose: "verify", email: "a@example.com" },
        NOW,
      );
      const secret = token.split(".", 3)[2];
      expect(secret).toBe(expected);
      expect(secret).not.toContain("+");
      expect(secret).not.toContain("/");
      expect(secret).not.toContain("=");
    } finally {
      getRandomValues.mockRestore();
    }
  });

  it("stop working when a newer one is sent", async () => {
    const { userId, email } = await seedUser({ isVerified: false });
    const first = await issueEmailLink(db, {
      userId,
      purpose: "verify",
      email,
    });
    const second = await issueEmailLink(db, {
      userId,
      purpose: "verify",
      email,
    });
    expect(await readEmailLink(db, first)).toBeUndefined();
    expect(await readEmailLink(db, second)).toBeDefined();
  });
});

describe("confirmEmail", () => {
  it("confirms the address once, then says it is already confirmed", async () => {
    const { userId, email } = await seedUser({ isVerified: false });
    const token = await issueEmailLink(
      db,
      { userId, purpose: "verify", email },
      NOW,
    );
    expect(await emailOf(userId)).toMatchObject({ isVerified: false });

    expect(await confirmEmail(db, token, undefined, NOW + 60)).toStrictEqual({
      state: "confirmed",
      purpose: "verify",
      email,
    });
    expect(await emailOf(userId)).toMatchObject({ isVerified: true });
    // `now` is epoch seconds, and `updatedAt` is stamped from it — wrong
    // arithmetic here lands the account's own `updatedAt` near 1970 instead
    // of the moment it was confirmed.
    const [row] = await db
      .select({ updatedAt: user.updatedAt })
      .from(user)
      .where(eq(user.id, userId));
    expect(row?.updatedAt).toStrictEqual(new Date((NOW + 60) * 1000));
    expect(await confirmEmail(db, token, undefined, NOW + 120)).toStrictEqual({
      state: "used",
    });
  });

  it("owes the link of the runner's garments in the confirmation's own batch (D-113 Q1)", async () => {
    const { userId, email } = await seedUser({ isVerified: false });
    const token = await issueEmailLink(
      db,
      { userId, purpose: "verify", email },
      NOW,
    );

    await confirmEmail(db, token, undefined, NOW + 60);

    const owed = await db
      .select({ kind: outbox.kind, payload: outbox.payload })
      .from(outbox)
      .where(eq(outbox.dedupeKey, userId));
    expect(owed).toStrictEqual([
      { kind: "product_link", payload: JSON.stringify({ userId }) },
    ]);
  });

  it("confirms nothing for a token that names no live link", async () => {
    expect(
      await confirmEmail(db, "not-a-real-token", undefined, NOW),
    ).toStrictEqual({ state: "expired" });
  });

  it("confirms nothing for a change link whose account is gone, before ever touching the outbox", async () => {
    const send = vi.spyOn(env.EMAIL, "send");
    const ghost = await issueEmailLink(
      db,
      {
        userId: "gone-change",
        purpose: "change",
        email: "new-for-gone@example.com",
      },
      NOW,
    );

    expect(await confirmEmail(db, ghost, undefined, NOW)).toStrictEqual({
      state: "expired",
    });
    expect(send).not.toHaveBeenCalled();
    send.mockRestore();
  });

  it("says a link has run out after 24 hours, and confirms nothing", async () => {
    const { userId, email } = await seedUser({ isVerified: false });
    const token = await issueEmailLink(
      db,
      { userId, purpose: "verify", email },
      NOW,
    );
    expect(
      await confirmEmail(db, token, undefined, NOW + EMAIL_LINK_TTL_S),
    ).toStrictEqual({ state: "expired" });
    expect(await emailOf(userId)).toMatchObject({ isVerified: false });
    // A second before, it works.
    expect(
      await confirmEmail(db, token, undefined, NOW + EMAIL_LINK_TTL_S - 1),
    ).toMatchObject({ state: "confirmed" });
  });

  it("confirms nothing for an address the account has since left, or an account that is gone", async () => {
    const moved = await seedUser({ isVerified: false });
    const token = await issueEmailLink(
      db,
      { userId: moved.userId, purpose: "verify", email: moved.email },
      NOW,
    );
    await db
      .update(user)
      .set({ email: `elsewhere-${newUlid().toLowerCase()}@example.com` })
      .where(eq(user.id, moved.userId));
    expect(await confirmEmail(db, token, undefined, NOW)).toStrictEqual({
      state: "expired",
    });
    expect(await emailOf(moved.userId)).toMatchObject({ isVerified: false });

    const ghost = await issueEmailLink(
      db,
      { userId: "gone", purpose: "verify", email: "gone@example.com" },
      NOW,
    );
    expect(await confirmEmail(db, ghost, undefined, NOW)).toStrictEqual({
      state: "expired",
    });
  });

  it("moves the account to a confirmed new address and tells the old one, through the outbox", async () => {
    const { userId, email } = await seedUser();
    const mail = fakeMail();
    const token = await issueEmailLink(
      db,
      { userId, purpose: "change", email: "new@example.com" },
      NOW,
    );

    expect(await confirmEmail(db, token, undefined, NOW + 1)).toStrictEqual({
      state: "confirmed",
      purpose: "change",
      email: "new@example.com",
    });
    expect(await emailOf(userId)).toStrictEqual({
      email: "new@example.com",
      isVerified: true,
    });
    expect(await confirmEmail(db, token, undefined, NOW + 2)).toStrictEqual({
      state: "used",
    });

    // The fast path sent the notice through the real binding; had it
    // failed, the row would be here. Deliver it again through a fake to
    // read what it says and to whom.
    expect(await db.select().from(outbox)).toHaveLength(0);
    const { deliverEmail } = await import("../../src/modules/email");
    await deliverEmail(
      db,
      {
        to: { address: email },
        template: { kind: "email_changed", newEmail: "new@example.com" },
      },
      mail,
    );
    expect(mail.sent[0]?.to).toBe(email);
  });

  it("keeps the notice owed when its send fails, written in the same batch as the move", async () => {
    const { userId } = await seedUser();
    const token = await issueEmailLink(
      db,
      { userId, purpose: "change", email: "moved@example.com" },
      NOW,
    );
    const send = vi
      .spyOn(env.EMAIL, "send")
      .mockRejectedValue(new Error("sender down"));
    const reports: Record<string, string>[] = [];

    await confirmEmail(
      db,
      token,
      {
        report: (_error, context) => {
          reports.push(context);
        },
      },
      NOW,
    );

    send.mockRestore();
    const after = await emailOf(userId);
    expect(after.email).toBe("moved@example.com");
    const rows = await db.select().from(outbox);
    expect(rows.map((row) => [row.kind, row.dedupeKey])).toStrictEqual([
      ["email", `email_changed:${userId}:${String(NOW)}`],
    ]);
    expect(reports).toMatchObject([
      { surface: "outbox-fast-path", kind: "email", template: "email_changed" },
    ]);
  });

  it("refuses to move onto an address someone has taken since", async () => {
    const { userId, email } = await seedUser();
    const other = await seedUser({ email: "wanted@example.com" });
    const token = await issueEmailLink(
      db,
      { userId, purpose: "change", email: other.email },
      NOW,
    );
    expect(await confirmEmail(db, token, undefined, NOW)).toStrictEqual({
      state: "expired",
    });
    const after = await emailOf(userId);
    expect(after.email).toBe(email);
  });
});

/**
The link's row as it stands: spent or not.
*/
async function usedAtOf(userId: string): Promise<(number | undefined)[]> {
  const rows = await db
    .select({ usedAt: emailVerifications.usedAt })
    .from(emailVerifications)
    .where(eq(emailVerifications.userId, userId));
  return rows.map((row) => row.usedAt ?? undefined);
}

describe("readEmailLanding (opening a link changes nothing)", () => {
  it("asks about a sign-up link with the address masked, and spends nothing", async () => {
    const { userId } = await seedUser({
      isVerified: false,
      email: `maya-${newUlid().toLowerCase()}@example.com`,
    });
    const { email } = await emailOf(userId);
    const token = await issueEmailLink(
      db,
      { userId, purpose: "verify", email },
      NOW,
    );

    expect(await readEmailLanding(db, token, NOW + 60)).toStrictEqual({
      state: "ask",
      purpose: "verify",
      email: "ma•••@example.com",
    });
    expect(await readEmailLanding(db, token, NOW + 61)).toMatchObject({
      state: "ask",
    });
    expect(await emailOf(userId)).toMatchObject({ isVerified: false });
    expect(await usedAtOf(userId)).toStrictEqual([undefined]);
    const [owed] = await db.select({ id: outbox.id }).from(outbox);
    expect(owed).toBeUndefined();

    // The button still works after the reads.
    expect(await confirmEmail(db, token, undefined, NOW + 120)).toMatchObject({
      state: "confirmed",
    });
  });

  it("asks about a change link naming the new address in full, and moves nothing", async () => {
    const { userId, email } = await seedUser();
    const next = `new-${newUlid().toLowerCase()}@example.com`;
    const token = await issueEmailLink(
      db,
      { userId, purpose: "change", email: next },
      NOW,
    );
    const sessionId = newUlid();
    await db.insert(session).values({
      id: sessionId,
      userId,
      token: newUlid(),
      expiresAt: new Date((NOW + 3600) * 1000),
      createdAt: new Date(NOW * 1000),
      updatedAt: new Date(NOW * 1000),
    });

    expect(await readEmailLanding(db, token, NOW + 1)).toStrictEqual({
      state: "ask",
      purpose: "change",
      email: next,
    });
    const unmoved = await emailOf(userId);
    expect(unmoved.email).toBe(email);
    expect(await usedAtOf(userId)).toStrictEqual([undefined]);
    const sessions = await db
      .select({ id: session.id })
      .from(session)
      .where(eq(session.userId, userId));
    expect(sessions).toStrictEqual([{ id: sessionId }]);
  });

  it("says a spent link was used, and a link that cannot be spent has run out", async () => {
    const { userId, email } = await seedUser({ isVerified: false });
    const token = await issueEmailLink(
      db,
      { userId, purpose: "verify", email },
      NOW,
    );
    expect(
      await readEmailLanding(db, token, NOW + EMAIL_LINK_TTL_S),
    ).toStrictEqual({ state: "expired" });
    expect(
      await readEmailLanding(db, token, NOW + EMAIL_LINK_TTL_S - 1),
    ).toMatchObject({ state: "ask" });
    await confirmEmail(db, token, undefined, NOW + 1);
    expect(await readEmailLanding(db, token, NOW + 2)).toStrictEqual({
      state: "used",
    });
    expect(await readEmailLanding(db, "not-a-link", NOW)).toStrictEqual({
      state: "expired",
    });
  });

  it("says a link has run out once its address is left or taken, or its account is gone", async () => {
    const moved = await seedUser({ isVerified: false });
    const left = await issueEmailLink(
      db,
      { userId: moved.userId, purpose: "verify", email: moved.email },
      NOW,
    );
    await db
      .update(user)
      .set({ email: `elsewhere-${newUlid().toLowerCase()}@example.com` })
      .where(eq(user.id, moved.userId));
    expect(await readEmailLanding(db, left, NOW)).toStrictEqual({
      state: "expired",
    });

    const mover = await seedUser();
    const taker = await seedUser({
      email: `taken-${newUlid().toLowerCase()}@example.com`,
    });
    const taken = await issueEmailLink(
      db,
      { userId: mover.userId, purpose: "change", email: taker.email },
      NOW,
    );
    expect(await readEmailLanding(db, taken, NOW)).toStrictEqual({
      state: "expired",
    });

    const ghost = await issueEmailLink(
      db,
      { userId: "gone", purpose: "verify", email: "gone@example.com" },
      NOW,
    );
    expect(await readEmailLanding(db, ghost, NOW)).toStrictEqual({
      state: "expired",
    });
  });
});

describe("confirmEmail, when two open one link (law 2)", () => {
  it("confirms once: the second hears it was used", async () => {
    const { userId, email } = await seedUser({ isVerified: false });
    const token = await issueEmailLink(
      db,
      { userId, purpose: "verify", email },
      NOW,
    );

    const landings = await Promise.all([
      confirmEmail(db, token, {}, NOW + 1),
      confirmEmail(db, token, {}, NOW + 1),
    ]);

    expect(
      landings
        .map((landing) => landing.state)
        .toSorted((a, b) => a.localeCompare(b)),
    ).toStrictEqual(["confirmed", "used"]);
    expect(await emailOf(userId)).toMatchObject({ isVerified: true });
  });

  it("moves the account once and tells the old address once", async () => {
    const { userId } = await seedUser();
    const token = await issueEmailLink(
      db,
      { userId, purpose: "change", email: "twice@example.com" },
      NOW,
    );
    const send = vi
      .spyOn(env.EMAIL, "send")
      .mockResolvedValue({ messageId: "sent-once" });

    const landings = await Promise.all([
      confirmEmail(db, token, {}, NOW + 1),
      confirmEmail(db, token, {}, NOW + 2),
    ]);

    expect(
      landings
        .map((landing) => landing.state)
        .toSorted((a, b) => a.localeCompare(b)),
    ).toStrictEqual(["confirmed", "used"]);
    expect(send).toHaveBeenCalledTimes(1);
    send.mockRestore();
    expect(await db.select().from(outbox)).toHaveLength(0);
    const moved = await emailOf(userId);
    expect(moved.email).toBe("twice@example.com");
  });

  it("hands the link back when the change it authorised does not land", async () => {
    const { userId, email } = await seedUser();
    const token = await issueEmailLink(
      db,
      { userId, purpose: "change", email: "retry@example.com" },
      NOW,
    );
    const batch = vi
      .spyOn(db, "batch")
      .mockRejectedValueOnce(new Error("D1 down"));

    await expect(confirmEmail(db, token, {}, NOW + 1)).rejects.toThrow(
      "D1 down",
    );
    batch.mockRestore();

    const unmoved = await emailOf(userId);
    expect(unmoved.email).toBe(email);
    expect(await readEmailLink(db, token)).toMatchObject({
      usedAt: undefined,
    });
    // The next tap does what the first could not.
    expect(await confirmEmail(db, token, {}, NOW + 2)).toMatchObject({
      state: "confirmed",
    });
  });

  it("hands a verify link back too, and only its own claim", async () => {
    const { userId, email } = await seedUser({ isVerified: false });
    const token = await issueEmailLink(
      db,
      { userId, purpose: "verify", email },
      NOW,
    );
    const update = vi.spyOn(db, "update");
    // The first update is the claim; the second, the confirm, fails.
    update.mockImplementationOnce((table) => {
      update.mockRestore();
      const claim = db.update(table);
      vi.spyOn(db, "update").mockImplementationOnce(() => {
        throw new Error("D1 down");
      });
      return claim;
    });

    await expect(confirmEmail(db, token, {}, NOW + 1)).rejects.toThrow(
      "D1 down",
    );
    vi.restoreAllMocks();

    expect(await emailOf(userId)).toMatchObject({ isVerified: false });
    expect(await readEmailLink(db, token)).toMatchObject({
      usedAt: undefined,
    });
    // Nothing confirmed, so nothing owed.
    expect(
      await db.select().from(outbox).where(eq(outbox.dedupeKey, userId)),
    ).toStrictEqual([]);
  });
});

/**
A live session row for this runner, as a sign-in would leave.
*/
async function sessionFor(userId: string): Promise<string> {
  const id = newUlid();
  const now = new Date();
  await db.insert(session).values({
    id,
    userId,
    token: `token-${id}`,
    expiresAt: new Date(now.getTime() + 86_400_000),
    createdAt: now,
    updatedAt: now,
  });
  return id;
}

async function sessionIds(): Promise<string[]> {
  const rows = await db.select({ id: session.id }).from(session);
  return rows.map((row) => row.id).toSorted((a, b) => a.localeCompare(b));
}

describe("confirmEmail, moving the account (ACC-8)", () => {
  it("withdraws every link still open for the runner — reset and confirm — and nobody else's", async () => {
    const { userId, email } = await seedUser();
    const bystander = await seedUser();
    const confirmLink = await issueEmailLink(
      db,
      { userId, purpose: "verify", email },
      NOW,
    );
    const theirLink = await issueEmailLink(
      db,
      { userId: bystander.userId, purpose: "verify", email: bystander.email },
      NOW,
    );
    // Better Auth's reset rows, as it writes them: the identifier hashed,
    // the runner in `value`.
    const expiresAt = new Date((NOW + 3600) * 1000);
    const at = new Date(NOW * 1000);
    await db.insert(verification).values(
      [userId, bystander.userId].map((value) => ({
        id: newUlid(),
        identifier: newUlid(),
        value,
        expiresAt,
        createdAt: at,
        updatedAt: at,
      })),
    );
    const change = await issueEmailLink(
      db,
      {
        userId,
        purpose: "change",
        email: `elsewhere-${newUlid().toLowerCase()}@example.com`,
      },
      NOW,
    );

    expect(await confirmEmail(db, change, undefined, NOW + 1)).toMatchObject({
      state: "confirmed",
    });

    expect(await readEmailLink(db, confirmLink)).toBeUndefined();
    expect(await readEmailLink(db, theirLink)).toBeDefined();
    const left = await db
      .select({ value: verification.value })
      .from(verification);
    expect(left.map((row) => row.value)).not.toContain(userId);
    expect(left.map((row) => row.value)).toContain(bystander.userId);
  });

  it("signs every other session out, keeps the one the link was opened in, and touches nobody else's", async () => {
    const { userId } = await seedUser();
    const here = await sessionFor(userId);
    await sessionFor(userId);
    await sessionFor(userId);
    const bystander = await seedUser();
    const theirs = await sessionFor(bystander.userId);
    const token = await issueEmailLink(
      db,
      { userId, purpose: "change", email: "kept@example.com" },
      NOW,
    );

    expect(
      await confirmEmail(db, token, { currentSessionId: here }, NOW + 1),
    ).toMatchObject({ state: "confirmed" });

    const left = await sessionIds();
    expect(left).toContain(here);
    expect(left).toContain(theirs);
    const mine = await db
      .select({ id: session.id })
      .from(session)
      .where(eq(session.userId, userId));
    expect(mine.map((row) => row.id)).toStrictEqual([here]);
  });

  it("signs every session out when the link is opened signed out", async () => {
    const { userId } = await seedUser();
    await sessionFor(userId);
    await sessionFor(userId);
    const token = await issueEmailLink(
      db,
      { userId, purpose: "change", email: "nobody-here@example.com" },
      NOW,
    );

    await confirmEmail(db, token, {}, NOW + 1);

    const mine = await db
      .select({ id: session.id })
      .from(session)
      .where(eq(session.userId, userId));
    expect(mine).toStrictEqual([]);
  });

  it("signs nobody out for a verify link", async () => {
    const { userId, email } = await seedUser({ isVerified: false });
    const kept = await sessionFor(userId);
    const token = await issueEmailLink(
      db,
      { userId, purpose: "verify", email },
      NOW,
    );

    await confirmEmail(db, token, {}, NOW + 1);

    expect(await sessionIds()).toContain(kept);
  });
});

/**
A deployment that does not limit (dev, CI): only the address is counted.
*/
const UNLIMITED = { ip: undefined, isLimited: false } as const;

describe("resendConfirmation", () => {
  it("sends a new link to an unconfirmed account, and the old one stops working", async () => {
    const mail = fakeMail();
    const later = inBackground();
    const { userId, email } = await seedUser({ isVerified: false });
    const old = await issueEmailLink(db, { userId, purpose: "verify", email });

    expect(
      await resendConfirmation(
        db,
        { email: email.toUpperCase(), visitor: UNLIMITED },
        mail,
        later.background,
        NOW,
      ),
    ).toStrictEqual({
      status: "sent",
    });
    // Nothing is sent until the background work runs.
    expect(mail.sent).toHaveLength(0);
    await later.settled();

    expect(mail.sent).toHaveLength(1);
    expect(mail.sent[0]).toMatchObject({
      to: email,
      subject: "Confirm your email for dialed.run",
    });
    const token = tokenIn(mail.sent[0]);
    expect(await readEmailLink(db, old)).toBeUndefined();
    expect(await readEmailLink(db, token)).toMatchObject({ userId });
    expect(mail.sent[0]?.html).toContain(
      confirmLinkUrl(ORIGIN, token).replaceAll("&", "&amp;"),
    );
  });

  it("answers the same for a confirmed account and for no account, sending the one and nothing to the other", async () => {
    const mail = fakeMail();
    const later = inBackground();
    const { email } = await seedUser();
    expect(
      await resendConfirmation(
        db,
        { email: email, visitor: UNLIMITED },
        mail,
        later.background,
        NOW,
      ),
    ).toStrictEqual({
      status: "sent",
    });
    expect(
      await resendConfirmation(
        db,
        { email: "nobody@example.com", visitor: UNLIMITED },
        mail,
        later.background,
        NOW,
      ),
    ).toStrictEqual({ status: "sent" });
    await later.settled();
    expect(mail.sent.map((message) => message.subject)).toStrictEqual([
      "You already have a dialed.run account",
    ]);
  });

  it("answers before it looks the address up, so no address answers slower for having an account", async () => {
    const mail = fakeMail();
    const later = inBackground();
    const { email } = await seedUser({ isVerified: false });
    const select = vi.spyOn(db, "select");
    const insert = vi.spyOn(db, "insert");

    // The same statements in the request path for an address with an
    // account and one without: the limit's, and nothing else.
    const work: number[][] = [];
    for (const address of [email, "nobody@example.com"]) {
      select.mockClear();
      insert.mockClear();
      expect(
        await resendConfirmation(
          db,
          { email: address, visitor: UNLIMITED },
          mail,
          later.background,
          NOW,
        ),
      ).toStrictEqual({ status: "sent" });
      work.push([select.mock.calls.length, insert.mock.calls.length]);
      // Let this address's background finish before counting the next.
      await later.settled();
    }
    select.mockRestore();
    insert.mockRestore();

    expect(work[0]).toStrictEqual(work[1]);
    expect(mail.sent.map((message) => message.to)).toStrictEqual([email]);
    expect(later.reports).toStrictEqual([]);
  });

  it("reports a send that fails in the background, and names no address", async () => {
    const mail = fakeMail();
    mail.failing(true);
    const later = inBackground();
    const { email } = await seedUser({ isVerified: false });

    expect(
      await resendConfirmation(
        db,
        { email: email, visitor: UNLIMITED },
        mail,
        later.background,
        NOW,
      ),
    ).toStrictEqual({ status: "sent" });
    await later.settled();

    expect(later.reports).toStrictEqual([{ surface: "resend-confirmation" }]);
  });

  it("hands nothing to the background once the limit is reached", async () => {
    const mail = fakeMail();
    const later = inBackground();
    const keepAlive = vi.fn(later.background.keepAlive);
    const background = { ...later.background, keepAlive };
    for (let n = 0; n < 5; n += 1) {
      await resendConfirmation(
        db,
        { email: "nobody@example.com", visitor: UNLIMITED },
        mail,
        background,
        NOW,
      );
    }
    expect(keepAlive).toHaveBeenCalledTimes(5);
    await resendConfirmation(
      db,
      { email: "nobody@example.com", visitor: UNLIMITED },
      mail,
      background,
      NOW,
    );
    expect(keepAlive).toHaveBeenCalledTimes(5);
    await later.settled();
  });

  it("says when the next link can go after five in an hour — for any address", async () => {
    const mail = fakeMail();
    const later = inBackground();
    for (let n = 0; n < 5; n += 1) {
      await resendConfirmation(
        db,
        { email: "nobody@example.com", visitor: UNLIMITED },
        mail,
        later.background,
        NOW,
      );
    }
    expect(
      await resendConfirmation(
        db,
        { email: "nobody@example.com", visitor: UNLIMITED },
        mail,
        later.background,
        NOW + 10,
      ),
    ).toStrictEqual({ status: "limited", until: NOW + 3600 });
  });

  it("shares its send limit's bucket with the other 'verify' emails, and 'reset' stays its own", async () => {
    // Resend, the new-account note and the existing-account note all name
    // the address a runner already has one confirm-link limit for — they
    // must count against the very same row, not three private ones, or the
    // "5 links this hour" ceiling stops meaning anything. `reset` is a
    // different limit on purpose: a runner who has used up their confirm
    // links can still reset a password.
    const mail = fakeMail();
    const later = inBackground();
    const hooks = authMail(db, () => mail, quiet);
    const { userId, email } = await seedUser({ isVerified: false });

    await resendConfirmation(
      db,
      { email: email, visitor: UNLIMITED },
      mail,
      later.background,
      NOW,
    );
    await later.settled();
    await hooks.newAccount({ id: userId, email });
    await hooks.existingAccount({ id: userId, email });
    await hooks.resetPassword({ id: userId, email }, "t");

    expect(await countedKeys(db)).toStrictEqual([
      `reset:${email}`,
      `verify:${email}`,
    ]);
  });

  it("counts the visitor before the address, whatever addresses they name (SA-M12)", async () => {
    const mail = fakeMail();
    const later = inBackground();
    const visitor = { ip: "2001:db8:1:2::1", isLimited: true };
    for (let n = 0; n < RESENDS_PER_VISITOR_PER_HOUR; n += 1) {
      expect(
        await resendConfirmation(
          db,
          {
            email: `nobody-${String(n)}@example.org`,
            visitor: {
              ...visitor,
              ip: `2001:db8:1:2::${(n + 1).toString(16)}`,
            },
          },
          mail,
          later.background,
          NOW,
        ),
      ).toStrictEqual({ status: "sent" });
    }
    expect(
      await resendConfirmation(
        db,
        { email: "one-more@example.org", visitor },
        mail,
        later.background,
        NOW + 10,
      ),
    ).toStrictEqual({ status: "visitor-limited", until: NOW + 3600 });
    await later.settled();
    // One row per address it allowed and one for the visitor: none for the
    // address it refused.
    const keys = await countedKeys(db);
    expect(keys).toHaveLength(RESENDS_PER_VISITOR_PER_HOUR + 1);
    expect(keys).toContain("resend-visitor:2001:db8:1:2::/64");
    expect(keys).not.toContain("verify:one-more@example.org");
    // Another visitor is not held up.
    expect(
      await resendConfirmation(
        db,
        {
          email: "one-more@example.org",
          visitor: { ...visitor, ip: "203.0.113.9" },
        },
        mail,
        later.background,
        NOW + 10,
      ),
    ).toStrictEqual({ status: "sent" });
    await later.settled();
  });

  it("counts a visitor with no address as one visitor", async () => {
    const later = inBackground();
    await resendConfirmation(
      db,
      {
        email: "nobody@example.org",
        visitor: { ip: undefined, isLimited: true },
      },
      fakeMail(),
      later.background,
      NOW,
    );
    await later.settled();
    expect(await countedKeys(db)).toContain("resend-visitor:unknown");
  });

  it("answers text that is not an address as one with no account, counting no address", async () => {
    const mail = fakeMail();
    const later = inBackground();
    const keepAlive = vi.fn(later.background.keepAlive);
    expect(
      await resendConfirmation(
        db,
        {
          email: "not an address",
          visitor: { ip: "203.0.113.9", isLimited: true },
        },
        mail,
        { ...later.background, keepAlive },
        NOW,
      ),
    ).toStrictEqual({ status: "sent" });
    expect(keepAlive).not.toHaveBeenCalled();
    expect(await countedKeys(db)).toStrictEqual(["resend-visitor:203.0.113.9"]);
  });

  it("counts no visitor where the deployment does not limit", async () => {
    const later = inBackground();
    await resendConfirmation(
      db,
      {
        email: "nobody@example.org",
        visitor: { ip: "203.0.113.9", isLimited: false },
      },
      fakeMail(),
      later.background,
      NOW,
    );
    await later.settled();
    expect(await countedKeys(db)).toStrictEqual(["verify:nobody@example.org"]);
  });
});

describe("authMail", () => {
  it("confirms a new account's address, tells a registered one, and resets confirmed and unconfirmed alike", async () => {
    const mail = fakeMail();
    const reports: unknown[] = [];
    const hooks = authMail(
      db,
      () => mail,
      (error) => {
        reports.push(error);
      },
    );
    const fresh = await seedUser({ isVerified: false });
    const known = await seedUser();

    await hooks.newAccount({ id: fresh.userId, email: fresh.email });
    await hooks.existingAccount({ id: known.userId, email: known.email });
    await hooks.resetPassword(
      { id: fresh.userId, email: fresh.email },
      "unconfirmed-token",
    );
    await hooks.resetPassword(
      { id: known.userId, email: known.email },
      "reset-token",
    );

    expect(
      mail.sent.map((message) => [message.to, message.subject]),
    ).toStrictEqual([
      [fresh.email, "Confirm your email for dialed.run"],
      [known.email, "You already have a dialed.run account"],
      // Unconfirmed too (owner, 2026-09-27): spending it confirms them.
      [fresh.email, "Set a new password for dialed.run"],
      [known.email, "Set a new password for dialed.run"],
    ]);
    expect(mail.sent[3]?.html).toContain(
      `${ORIGIN}/account/reset?token=reset-token`,
    );
    expect(reports).toStrictEqual([]);
  });

  it("never fails the request it rides on: a failed send is reported", async () => {
    const mail = fakeMail();
    mail.failing(true);
    const reports: Record<string, string>[] = [];
    const hooks = authMail(
      db,
      () => mail,
      (_error, context) => {
        reports.push(context);
      },
    );
    const { userId, email } = await seedUser();
    await expect(
      hooks.newAccount({ id: userId, email }),
    ).resolves.toBeUndefined();
    await expect(
      hooks.existingAccount({ id: userId, email }),
    ).resolves.toBeUndefined();
    await expect(
      hooks.resetPassword({ id: userId, email }, "t"),
    ).resolves.toBeUndefined();
    expect(reports).toStrictEqual([
      { surface: "verify-email", userId },
      { surface: "existing-account-email", userId },
      { surface: "reset-password-email", userId },
    ]);
  });

  it("stops filling an inbox: the registered-address email and the reset are limited too", async () => {
    const mail = fakeMail();
    const hooks = authMail(db, () => mail, quiet);
    const { userId, email } = await seedUser();
    for (let n = 0; n < 7; n += 1) {
      await hooks.existingAccount({ id: userId, email });
      await hooks.resetPassword({ id: userId, email }, "t");
    }
    const subjects = mail.sent.map((message) => message.subject);
    expect(
      subjects.filter((subject) => subject.startsWith("You already")),
    ).toHaveLength(5);
    expect(
      subjects.filter((subject) => subject.startsWith("Set a new")),
    ).toHaveLength(5);
  });
});

describe("requestEmailChange", () => {
  it("sends the confirm link to the new address after the answer, and owes nothing (SA-L18)", async () => {
    const mail = fakeMail();
    const later = owedTo(mail);
    const { userId, email } = await seedUser();

    expect(
      await requestEmailChange(
        db,
        change(userId, "Fresh@Example.com"),
        mail,
        later.owed,
        NOW,
      ),
    ).toStrictEqual({ status: "sent" });
    // No outbox row holds the link: it is sent, not owed.
    expect(await db.select().from(outbox)).toHaveLength(0);

    await later.settled();
    expect(mail.sent[0]).toMatchObject({
      to: "fresh@example.com",
      subject: "Confirm your new email for dialed.run",
    });
    expect(await db.select().from(outbox)).toHaveLength(0);
    // Nothing has moved until the link is opened.
    const after = await emailOf(userId);
    expect(after.email).toBe(email);
    const token = tokenIn(mail.sent[0]);
    expect(await readEmailLink(db, token)).toMatchObject({
      purpose: "change",
      email: "fresh@example.com",
    });
    // Its own bucket, named "change" — not the "verify" links' one.
    expect(await countedKeys(db)).toStrictEqual([
      `change-runner:${userId}`,
      "change:fresh@example.com",
    ]);
  });

  it("does the same work for an address with an account: its owner is owed the existing-account email", async () => {
    const mail = fakeMail();
    const later = owedTo(mail);
    const { userId } = await seedUser();
    const other = await seedUser({ email: "held@example.com" });
    const keepAlive = vi.fn(later.owed.keepAlive);

    expect(
      await requestEmailChange(
        db,
        change(userId, "Held@Example.com"),
        mail,
        { ...later.owed, keepAlive },
        NOW,
      ),
    ).toStrictEqual({ status: "sent" });
    expect(mail.sent).toHaveLength(0);
    const owed = await db.select({ key: outbox.dedupeKey }).from(outbox);
    expect(owed).toHaveLength(1);
    // Its own key per request, named for what it is.
    expect(owed[0]?.key).toMatch(
      new RegExp(`^email_change_taken:${userId}:[0-9A-Z]{26}$`, "u"),
    );
    expect(keepAlive).toHaveBeenCalledTimes(1);

    await later.settled();
    expect(mail.sent).toHaveLength(1);
    expect(mail.sent[0]).toMatchObject({
      to: other.email,
      subject: "You already have a dialed.run account",
    });
    // No link: the address cannot become this runner's.
    expect(await db.select().from(emailVerifications)).toHaveLength(0);
  });

  it("sends each request its own link, to the address it named", async () => {
    const mail = fakeMail();
    const later = owedTo(mail);
    const { userId } = await seedUser();
    for (const address of ["first@example.com", "second@example.com"]) {
      await requestEmailChange(
        db,
        change(userId, address),
        mail,
        later.owed,
        NOW,
      );
    }
    await later.settled();
    expect(await db.select().from(outbox)).toHaveLength(0);
    expect(mail.sent.map((message) => message.to)).toStrictEqual([
      "first@example.com",
      "second@example.com",
    ]);
    expect(await readEmailLink(db, tokenIn(mail.sent[1]))).toMatchObject({
      email: "second@example.com",
    });
  });

  it("reports a link that would not send, and keeps the link's row (SA-L18)", async () => {
    const mail = fakeMail();
    mail.failing(true);
    const reported: Record<string, string>[] = [];
    const work: Promise<unknown>[] = [];
    const { userId } = await seedUser();
    await requestEmailChange(
      db,
      change(userId, "fresh@example.com"),
      mail,
      {
        keepAlive: (promise) => {
          work.push(promise);
        },
        report: (_error, context) => {
          reported.push(context);
        },
        settle: () => Promise.resolve(),
      },
      NOW,
    );
    await Promise.all(work);
    expect(reported).toStrictEqual([{ surface: "email-change-link" }]);
    expect(await db.select().from(outbox)).toHaveLength(0);
  });

  it("asks for the current password, and does nothing else when it is wrong", async () => {
    const mail = fakeMail();
    const later = owedTo(mail);
    const { userId } = await seedUser();
    const asked: string[] = [];

    expect(
      await requestEmailChange(
        db,
        change(userId, "taken-over@example.com", (password) => {
          asked.push(password);
          return Promise.resolve({ status: "wrong" });
        }),
        mail,
        later.owed,
        NOW,
      ),
    ).toStrictEqual({ status: "wrong-password" });

    expect(asked).toStrictEqual([TYPED]);
    await later.settled();
    expect(mail.sent).toHaveLength(0);
    // Not a send, so not counted against the address, and no link made.
    expect(await db.select().from(rateLimits)).toHaveLength(0);
    expect(await db.select().from(emailVerifications)).toHaveLength(0);
    expect(await db.select().from(outbox)).toHaveLength(0);
  });

  it("says when the next try may go once the tries at the password are used up, and does nothing else", async () => {
    const mail = fakeMail();
    const later = owedTo(mail);
    const { userId } = await seedUser();
    expect(
      await requestEmailChange(
        db,
        change(userId, "new@example.com", () =>
          Promise.resolve({ status: "limited", until: NOW + 900 }),
        ),
        mail,
        later.owed,
        NOW,
      ),
    ).toStrictEqual({ status: "password-limited", until: NOW + 900 });
    expect(await db.select().from(rateLimits)).toHaveLength(0);
    expect(await db.select().from(outbox)).toHaveLength(0);
  });

  it("is limited per new address, whoever asks", async () => {
    const mail = fakeMail();
    // Five runners, one request each, so no runner's own count is reached.
    for (let n = 0; n < EMAIL_SENDS_PER_HOUR; n += 1) {
      const { userId } = await seedUser();
      expect(
        await requestEmailChange(
          db,
          change(userId, "spam@example.com"),
          mail,
          owedTo(mail).owed,
          NOW,
        ),
      ).toStrictEqual({ status: "sent" });
    }
    const { userId } = await seedUser();
    expect(
      await requestEmailChange(
        db,
        change(userId, "spam@example.com"),
        mail,
        owedTo(mail).owed,
        NOW,
      ),
    ).toStrictEqual({ status: "limited", until: NOW + 3600 });
  });

  it("is limited per runner, across different new addresses, and sends nothing past it", async () => {
    const mail = fakeMail();
    const later = owedTo(mail);
    const { userId } = await seedUser();
    const ask = (n: number, at = NOW) =>
      requestEmailChange(
        db,
        change(userId, `stranger-${String(n)}@example.com`),
        mail,
        later.owed,
        at,
      );
    for (let n = 0; n < EMAIL_SENDS_PER_HOUR; n += 1) {
      expect(await ask(n)).toStrictEqual({ status: "sent" });
    }
    expect(await ask(EMAIL_SENDS_PER_HOUR)).toStrictEqual({
      status: "runner-limited",
      until: NOW + 3600,
    });
    await later.settled();
    // One link per request let through, and none owed.
    expect(await db.select().from(outbox)).toHaveLength(0);
    expect(mail.sent).toHaveLength(EMAIL_SENDS_PER_HOUR);
    // The refused address was not counted against its owner.
    expect(await countedKeys(db)).not.toContain(
      `change:stranger-${String(EMAIL_SENDS_PER_HOUR)}@example.com`,
    );
    // A new hour starts the runner's count over.
    expect(await ask(EMAIL_SENDS_PER_HOUR + 1, NOW + 3600)).toStrictEqual({
      status: "sent",
    });
  });

  it("limits each runner on their own count", async () => {
    const mail = fakeMail();
    const first = await seedUser();
    const second = await seedUser();
    for (let n = 0; n <= EMAIL_SENDS_PER_HOUR; n += 1) {
      await requestEmailChange(
        db,
        change(first.userId, `first-${String(n)}@example.com`),
        mail,
        owedTo(mail).owed,
        NOW,
      );
    }
    expect(
      await requestEmailChange(
        db,
        change(second.userId, "second@example.com"),
        mail,
        owedTo(mail).owed,
        NOW,
      ),
    ).toStrictEqual({ status: "sent" });
  });
});

/**
 * The background a request hands its after-the-answer work to — collected
 * here, so a test can look before it runs and after it has.
 */
function inBackground(): {
  background: Background;
  reports: Record<string, string>[];
  settled: () => Promise<void>;
} {
  const work: Promise<unknown>[] = [];
  const reports: Record<string, string>[] = [];
  return {
    background: {
      keepAlive: (promise) => {
        work.push(promise);
      },
      report: (_error, context) => {
        reports.push(context);
      },
    },
    reports,
    settled: async () => {
      await Promise.all(work);
    },
  };
}

/**
 * An email change asked for with the right password, unless the check
 * says otherwise.
 */
function change(
  userId: string,
  newEmail: string,
  check: EmailChangeRequest["checkPassword"] = () =>
    Promise.resolve({ status: "own" }),
): EmailChangeRequest {
  return {
    userId,
    newEmail,
    currentPassword: TYPED,
    checkPassword: check,
  };
}

/**
Not a secret: what the change form was typed with, checked by a fake.
*/
const TYPED = ["the", "current", "password"].join("-");
