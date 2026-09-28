/**
 * Confirming an address, and changing one (ACC-3, ACC-8; round 26 #11;
 * decision D-50).
 *
 * The emails here are what the runner just asked for — confirm this,
 * send it again, move my account — so they are sent now, one attempt
 * (law 3), and a failure is the runner's to retry from the page. They
 * carry a live token, which an outbox row should not hold. The one
 * secondary email, the notice to the old address after a change, rides
 * the outbox in the same batch as the change (law 8c).
 */
import { and, eq, ne } from "drizzle-orm";
import type { drizzle } from "drizzle-orm/d1";

import { session, user } from "../../db/schema-auth";
import {
  firstColumnWhere,
  firstRowWhere,
  hasRowWhere,
} from "../../lib/keyed-read";
import { nowSeconds } from "../../lib/now";
import {
  claimEmailSend,
  deliverEmail,
  emailDebt,
  type EmailDeps,
} from "../email";
import { outboxInsert, oweOutbox, settleOutbox } from "../ops";
import {
  didClaimEmailLink,
  isVerified,
  issueEmailLink,
  readEmailLink,
  releaseEmailLink,
  type LinkPurpose,
  type ReadLink,
} from "./email-links";

type Db = ReturnType<typeof drizzle>;
type Report = (error: unknown, context: Record<string, string>) => void;

/**
The page a confirm link opens (Au4's "Email verify" button).
*/
export function confirmLinkUrl(origin: string, token: string): string {
  return `${origin}/account/verify?${new URLSearchParams({ token }).toString()}`;
}

interface Account {
  readonly id: string;
  readonly email: string;
}

/**
 * Send this runner a fresh link for the address they signed up with. The
 * previous link, if any, stops working.
 */
async function sendConfirmLink(
  db: Db,
  account: Account,
  deps: EmailDeps,
): Promise<void> {
  const token = await issueEmailLink(db, {
    userId: account.id,
    purpose: "verify",
    email: account.email,
  });
  await deliverEmail(
    db,
    {
      to: { userId: account.id },
      template: {
        kind: "verify_email",
        url: confirmLinkUrl(deps.origin, token),
      },
    },
    deps,
  );
}

/**
 * Au4's Resend, and "Log in to resend": the same answer whoever asks and
 * whatever the address — a new link to an unconfirmed account, the
 * "You already have an account" email to a confirmed one, nothing at all
 * to an address with no account — so the page reveals nothing (round 26
 * #11, "Au3's exception is retired"). Only the limit differs, and it is
 * counted per address whether or not the address has an account.
 *
 * **The same answer in the same time**, too: everything after the limit
 * — the lookup, the link, the send — runs in the background, so an
 * address with an account is not the one that answers slower. A send that
 * fails there is reported; the runner's next Resend is the retry.
 */
export type ResendResult =
  | { readonly status: "sent" }
  | { readonly status: "limited"; readonly until: number };

/**
 * Work the answer does not wait on: `waitUntil` to keep the Worker alive
 * for it, and where a failure in it is reported (law 7).
 */
export interface Background {
  readonly keepAlive: (work: Promise<unknown>) => void;
  readonly report: Report;
}

async function sendConfirmationTo(
  db: Db,
  email: string,
  deps: EmailDeps,
): Promise<void> {
  const account = await firstRowWhere(
    db,
    user,
    eq(user.email, email.toLowerCase()),
  );
  if (account === undefined) return;
  if (account.emailVerified) {
    await deliverEmail(
      db,
      { to: { userId: account.id }, template: { kind: "existing_account" } },
      deps,
    );
  } else {
    await sendConfirmLink(db, account, deps);
  }
}

/**
 * The background half of a Resend: nothing awaits it, so a failure is
 * reported here or nowhere.
 */
async function sendReported(
  db: Db,
  email: string,
  deps: EmailDeps,
  report: Report,
): Promise<void> {
  try {
    await sendConfirmationTo(db, email, deps);
  } catch (error) {
    // Never the address (law 7): the surface is enough to find it.
    report(error, { surface: "resend-confirmation" });
  }
}

export async function resendConfirmation(
  db: Db,
  email: string,
  deps: EmailDeps,
  background: Background,
  now = nowSeconds(),
): Promise<ResendResult> {
  const claim = await claimEmailSend(db, "verify", email, now);
  if (!claim.isAllowed) return { status: "limited", until: claim.until };
  background.keepAlive(sendReported(db, email, deps, background.report));
  return { status: "sent" };
}

/**
 * What Better Auth calls when an account is made, a sign-up names an
 * address that already has one, or a reset is asked for (`createAuth`'s
 * `mail`). None of them may fail the request that caused it: sign-up
 * answers Au4 either way, and a reset request answers "check your inbox"
 * either way (law 5). A failure is reported; the runner's Resend is the
 * retry.
 */
export interface AuthMail {
  readonly newAccount: (account: Account) => Promise<void>;
  readonly existingAccount: (account: Account) => Promise<void>;
  readonly resetPassword: (account: Account, token: string) => Promise<void>;
}

export function authMail(
  db: Db,
  deps: () => EmailDeps,
  report: Report,
): AuthMail {
  async function quietly(
    surface: string,
    userId: string,
    send: () => Promise<void>,
  ): Promise<void> {
    try {
      await send();
    } catch (error) {
      report(error, { surface, userId });
    }
  }
  return {
    newAccount: (account) =>
      quietly("verify-email", account.id, async () => {
        await claimEmailSend(db, "verify", account.email);
        await sendConfirmLink(db, account, deps());
      }),
    existingAccount: (account) =>
      quietly("existing-account-email", account.id, async () => {
        // Counted with the confirm links: signing up again and again for
        // someone's address is one way to fill their inbox.
        const claim = await claimEmailSend(db, "verify", account.email);
        if (!claim.isAllowed) return;
        await deliverEmail(
          db,
          {
            to: { userId: account.id },
            template: { kind: "existing_account" },
          },
          deps(),
        );
      }),
    resetPassword: (account, token) =>
      quietly("reset-password-email", account.id, async () => {
        // An unconfirmed runner may reset too (owner, 2026-09-27): the
        // link goes to the address they signed up with, and spending it
        // confirms that address (`createAuth`'s `onPasswordReset`).
        const claim = await claimEmailSend(db, "reset", account.email);
        if (!claim.isAllowed) return;
        const mail = deps();
        await deliverEmail(
          db,
          {
            to: { userId: account.id },
            template: {
              kind: "reset_password",
              url: `${mail.origin}/account/reset?${new URLSearchParams({ token }).toString()}`,
            },
          },
          mail,
        );
      }),
  };
}

/**
 * The confirm landings round 26 draws: "Email confirmed", "Your email is
 * confirmed" (a used link) and "That link has run out" (expired, replaced
 * by a newer one, or not a link at all — none of which a runner can do
 * anything about but ask again).
 */
export type Landing =
  | {
      readonly state: "confirmed";
      readonly purpose: LinkPurpose;
      readonly email: string;
    }
  | { readonly state: "used" }
  | { readonly state: "expired" };

const EXPIRED: Landing = { state: "expired" };
const USED: Landing = { state: "used" };

/**
 * Every session of this runner's but the one named — which may be none,
 * for a link opened where nobody is signed in.
 */
function otherSessionsOf(userId: string, keep: string | undefined) {
  return keep === undefined
    ? eq(session.userId, userId)
    : and(eq(session.userId, userId), ne(session.id, keep));
}

/**
 * The link's work, once it is claimed. A failure hands the link back, so
 * the runner's next tap tries again rather than reading "already used" for
 * a change that never landed.
 */
async function spendClaimed(
  db: Db,
  link: ReadLink,
  now: number,
  work: () => Promise<unknown>,
): Promise<void> {
  try {
    await work();
  } catch (error) {
    await releaseEmailLink(db, link, now);
    throw error;
  }
}

export interface ConfirmOptions {
  readonly report?: Report | undefined;
  /**
   * The session the link was opened in, when there is one: an email
   * change signs every other session out, and this one stays.
   */
  readonly currentSessionId?: string | undefined;
}

/**
 * Spend a link. For `verify`, the account's address is confirmed; for
 * `change`, the account moves to the new address, which the link has just
 * confirmed, the old address is told (outbox, law 8c), and every other
 * session is signed out — whoever else holds one was signed in to the old
 * address.
 *
 * Claim, then work (law 2): two tabs opening one link both read it
 * unspent, and only the one whose claim lands acts on it. The other hears
 * it was used.
 */
export async function confirmEmail(
  db: Db,
  token: unknown,
  options: ConfirmOptions = {},
  now = nowSeconds(),
): Promise<Landing> {
  const link = await readEmailLink(db, token);
  if (link === undefined) return EXPIRED;
  if (link.usedAt !== undefined) return USED;
  if (link.expiresAt <= now) return EXPIRED;
  const current = await firstColumnWhere(
    db,
    user,
    user.email,
    eq(user.id, link.userId),
  );
  if (current === undefined) return EXPIRED;
  const updatedAt = new Date(now * 1000);
  const confirmed: Landing = {
    state: "confirmed",
    purpose: link.purpose,
    email: link.email,
  };

  if (link.purpose === "verify") {
    // A link for an address the account has since left confirms nothing.
    if (current !== link.email) return EXPIRED;
    if (!(await didClaimEmailLink(db, link, now))) return USED;
    await spendClaimed(db, link, now, () =>
      db
        .update(user)
        .set({ emailVerified: true, updatedAt })
        .where(eq(user.id, link.userId)),
    );
    return confirmed;
  }

  // Someone else has taken the address since the link was sent: the
  // unique index would refuse the move, so say the link has run out.
  if (await hasRowWhere(db, user, user.email, eq(user.email, link.email)))
    return EXPIRED;
  if (!(await didClaimEmailLink(db, link, now))) return USED;
  const notice = oweOutbox(
    emailDebt(
      {
        to: { address: current },
        template: { kind: "email_changed", newEmail: link.email },
      },
      { dedupeKey: `email_changed:${link.userId}:${String(now)}` },
    ),
  );
  await spendClaimed(db, link, now, () =>
    db.batch([
      db
        .update(user)
        .set({ email: link.email, emailVerified: true, updatedAt })
        .where(eq(user.id, link.userId)),
      db
        .delete(session)
        .where(otherSessionsOf(link.userId, options.currentSessionId)),
      outboxInsert(db, notice, now),
    ]),
  );
  await settleOutbox(db, notice, options.report);
  return confirmed;
}

/**
 * ACC-8: move the account to a new address, once the runner proves they
 * hold it. Waits for a confirmed address (round 26 #11) — `unverified` is
 * the "Confirm your email first" sheet — and for the account's current
 * password: a session left open on a shared machine must not be enough to
 * take the account's address, and with it every reset link after.
 *
 * An address that already has an account answers "sent" and is sent
 * nothing, so this form cannot be used to find out who has one.
 */
export type ChangeResult =
  | ResendResult
  | { readonly status: "unverified" }
  | { readonly status: "wrong-password" };

export interface EmailChangeRequest {
  readonly userId: string;
  readonly newEmail: string;
  readonly currentPassword: string;
  /**
   * Whether the password is this account's — Better Auth's own check,
   * wired by the server function (`auth`'s `isCurrentPassword`).
   */
  readonly isOwnPassword: (password: string) => Promise<boolean>;
}

export async function requestEmailChange(
  db: Db,
  request: EmailChangeRequest,
  deps: EmailDeps,
  now = nowSeconds(),
): Promise<ChangeResult> {
  const { userId } = request;
  if (!(await isVerified(db, userId))) return { status: "unverified" };
  if (!(await request.isOwnPassword(request.currentPassword))) {
    return { status: "wrong-password" };
  }
  const email = request.newEmail.toLowerCase();
  const claim = await claimEmailSend(db, "change", email, now);
  if (!claim.isAllowed) return { status: "limited", until: claim.until };
  if (await hasRowWhere(db, user, user.email, eq(user.email, email))) {
    return { status: "sent" };
  }
  const token = await issueEmailLink(
    db,
    { userId, purpose: "change", email },
    now,
  );
  await deliverEmail(
    db,
    {
      to: { address: email },
      template: {
        kind: "email_change",
        url: confirmLinkUrl(deps.origin, token),
        newEmail: email,
      },
    },
    deps,
  );
  return { status: "sent" };
}
