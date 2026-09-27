import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { user } from "../../src/db/schema-auth";
import { env } from "../../src/env";
import {
  emailSendLimits,
  emailVerifications,
  outbox,
} from "../../src/db/schema-core";
import {
  authMail,
  confirmEmail,
  isVerified,
  requestEmailChange,
  resendConfirmation,
} from "../../src/modules/account";
import {
  EMAIL_LINK_TTL_S,
  issueEmailLink,
  readEmailLink,
} from "../../src/modules/account/email-links";
import { confirmLinkUrl } from "../../src/modules/account/verification";
import { core, fakeMail, ORIGIN, seedUser } from "../email/helpers";

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
    db.delete(emailSendLimits),
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
    expect(await readEmailLink(db, token)).toStrictEqual({
      userId,
      purpose: "verify",
      email,
      expiresAt: NOW + EMAIL_LINK_TTL_S,
      usedAt: undefined,
    });
    expect(EMAIL_LINK_TTL_S).toBe(86_400);

    // Only the hash is stored.
    const [row] = await db.select().from(emailVerifications);
    expect(row?.tokenHash).not.toContain(token.split(".", 3)[2] ?? "");

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
    expect(await isVerified(db, userId)).toBe(false);

    expect(await confirmEmail(db, token, undefined, NOW + 60)).toStrictEqual({
      state: "confirmed",
      purpose: "verify",
      email,
    });
    expect(await isVerified(db, userId)).toBe(true);
    expect(await confirmEmail(db, token, undefined, NOW + 120)).toStrictEqual({
      state: "used",
    });
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
    expect(await isVerified(db, userId)).toBe(false);
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
      .set({ email: "elsewhere@example.com" })
      .where(eq(user.id, moved.userId));
    expect(await confirmEmail(db, token, undefined, NOW)).toStrictEqual({
      state: "expired",
    });
    expect(await isVerified(db, moved.userId)).toBe(false);

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
      (_error, context) => {
        reports.push(context);
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

describe("resendConfirmation", () => {
  it("sends a new link to an unconfirmed account, and the old one stops working", async () => {
    const mail = fakeMail();
    const { userId, email } = await seedUser({ isVerified: false });
    const old = await issueEmailLink(db, { userId, purpose: "verify", email });

    expect(
      await resendConfirmation(db, email.toUpperCase(), mail, NOW),
    ).toStrictEqual({
      status: "sent",
    });

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
    const { email } = await seedUser();
    expect(await resendConfirmation(db, email, mail, NOW)).toStrictEqual({
      status: "sent",
    });
    expect(
      await resendConfirmation(db, "nobody@example.com", mail, NOW),
    ).toStrictEqual({ status: "sent" });
    expect(mail.sent.map((message) => message.subject)).toStrictEqual([
      "You already have a dialed.run account",
    ]);
  });

  it("says when the next link can go after five in an hour — for any address", async () => {
    const mail = fakeMail();
    for (let n = 0; n < 5; n += 1) {
      await resendConfirmation(db, "nobody@example.com", mail, NOW);
    }
    expect(
      await resendConfirmation(db, "nobody@example.com", mail, NOW + 10),
    ).toStrictEqual({ status: "limited", until: NOW + 3600 });
  });
});

describe("authMail", () => {
  it("confirms a new account's address, tells a registered one, and resets only a confirmed one", async () => {
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
      { id: fresh.userId, email: fresh.email, emailVerified: false },
      "unconfirmed-token",
    );
    await hooks.resetPassword(
      { id: known.userId, email: known.email, emailVerified: true },
      "reset-token",
    );

    expect(
      mail.sent.map((message) => [message.to, message.subject]),
    ).toStrictEqual([
      [fresh.email, "Confirm your email for dialed.run"],
      [known.email, "You already have a dialed.run account"],
      [known.email, "Set a new password for dialed.run"],
    ]);
    expect(mail.sent[2]?.html).toContain(
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
      hooks.resetPassword({ id: userId, email, emailVerified: true }, "t"),
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
      await hooks.resetPassword(
        { id: userId, email, emailVerified: true },
        "t",
      );
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
  it("sends the confirm link to the new address, and waits for it", async () => {
    const mail = fakeMail();
    const { userId, email } = await seedUser();

    expect(
      await requestEmailChange(db, userId, "Fresh@Example.com", mail, NOW),
    ).toStrictEqual({ status: "sent" });

    expect(mail.sent[0]).toMatchObject({
      to: "fresh@example.com",
      subject: "Confirm your new email for dialed.run",
    });
    // Nothing has moved until the link is opened.
    const after = await emailOf(userId);
    expect(after.email).toBe(email);
    const token = tokenIn(mail.sent[0]);
    expect(await readEmailLink(db, token)).toMatchObject({
      purpose: "change",
      email: "fresh@example.com",
    });
  });

  it("waits for a confirmed address first", async () => {
    const mail = fakeMail();
    const { userId } = await seedUser({ isVerified: false });
    expect(
      await requestEmailChange(db, userId, "new@example.com", mail, NOW),
    ).toStrictEqual({ status: "unverified" });
    expect(mail.sent).toHaveLength(0);
  });

  it("answers an address with an account as it answers any other, and sends it nothing", async () => {
    const mail = fakeMail();
    const { userId } = await seedUser();
    const other = await seedUser({ email: "held@example.com" });
    expect(
      await requestEmailChange(db, userId, other.email, mail, NOW),
    ).toStrictEqual({ status: "sent" });
    expect(mail.sent).toHaveLength(0);
  });

  it("is limited per new address", async () => {
    const mail = fakeMail();
    const { userId } = await seedUser();
    for (let n = 0; n < 5; n += 1) {
      await requestEmailChange(db, userId, "spam@example.com", mail, NOW);
    }
    expect(
      await requestEmailChange(db, userId, "spam@example.com", mail, NOW),
    ).toStrictEqual({ status: "limited", until: NOW + 3600 });
  });
});

function quiet(): void {
  // these sends succeed, so there is nothing to report
}
