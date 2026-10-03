/**
 * Ban mechanics (packet §4): content hidden everywhere, sessions revoked,
 * sign-in blocked. No appeal flow at MVP — the ban notice carries an email
 * address, and that is deliberate rather than unfinished.
 *
 * **A ban is one fact.** `banned_at IS NOT NULL` is the whole of it. A
 * boolean beside a date would be two facts that can disagree, and the one
 * that disagrees silently is the one that decides whether somebody can
 * sign in.
 *
 * **The three effects are not interchangeable, and all three are needed.**
 * Hiding content without revoking sessions leaves the banned account
 * posting; revoking sessions without blocking sign-in means they are back
 * in a page refresh later. The test asserts all three, because any two of
 * them looks like it works.
 */
import { eq } from "drizzle-orm";
import type { BatchItem } from "drizzle-orm/batch";
import { drizzle } from "drizzle-orm/d1";

import { session } from "../../db/schema-auth";
import { userProfiles } from "../../db/schema-core";
import { env } from "../../env";
import { firstRowWhere } from "../../lib/sql/keyed-read";
import type { OutboxMessage } from "../../lib/sql/outbox";
import { orSqlNull } from "../../lib/sql/sql-null";
import { nowSeconds } from "../../lib/now";
import { emailDebt } from "../email";

import { moderationActionInsert } from "./moderation-actions";

function db() {
  return drizzle(env.DIALED_CORE);
}

export interface BanInput {
  userId: string;
  reason: string;
  bannedBy: string;
}

/**
 * Bans a user and drops every session they hold.
 *
 * **One batch**, and this is the case the rule exists for: the ban and the
 * session revocation are a claim plus the thing that enforces it. A gap
 * between them is a banned account with live sessions, which is precisely
 * the state a ban is supposed to make impossible.
 *
 * Idempotent — banning someone already banned rewrites the same row rather
 * than failing. A moderator clicking twice on a slow connection should not
 * see an error about the thing they wanted to happen.
 */
export async function banUser(
  input: BanInput,
  also: (database: ReturnType<typeof db>) => BatchItem<"sqlite">[] = () => [],
): Promise<void> {
  const bannedAt = nowSeconds();
  await db().batch([
    db()
      .update(userProfiles)
      .set({ bannedAt, banReason: input.reason })
      .where(eq(userProfiles.userId, input.userId)),
    // Deleting rather than expiring: an expired session is still a row
    // Better Auth has to be trusted to reject, and a deleted one cannot be
    // got wrong by anybody.
    db().delete(session).where(eq(session.userId, input.userId)),
    moderationActionInsert(db(), {
      actorId: input.bannedBy,
      action: "ban",
      subjectType: "profile",
      subjectId: input.userId,
      subjectOwnerId: input.userId,
      reason: input.reason,
    }),
    ...also(db()),
  ]);
}

/**
 * The ban's email (round 27 #15, "Email ban"), as an outbox message: the
 * server function owes it through `ops` and hands `banUser` its insert
 * (`also`), so it lands in the ban's batch. Safety cannot reach `ops`
 * itself — `ops` imports safety. Keyed by the runner, so a second click
 * on Close account replaces the debt rather than sending twice.
 */
export function banEmail(input: BanInput): OutboxMessage {
  return emailDebt(
    {
      to: { userId: input.userId },
      template: { kind: "account_closed", reason: input.reason },
    },
    { dedupeKey: `account_closed:${input.userId}` },
  );
}

/**
 * Lifts a ban. No appeal flow exists (packet §4), so the only caller is a
 * person who decided directly — but the path has to exist, because a ban
 * applied by mistake with no way back is worse than no ban mechanism.
 *
 * Sessions are not restored, and could not be: they were deleted. The user
 * signs in again, which is the correct outcome.
 *
 * `also` is the reopen email's insert (D-89, `reopenEmail`), in the lift's
 * batch as `banUser`'s ban email is in the ban's.
 */
export async function unbanUser(
  userId: string,
  unbannedBy: string,
  also: (database: ReturnType<typeof db>) => BatchItem<"sqlite">[] = () => [],
): Promise<void> {
  const lift = db()
    .update(userProfiles)
    // orSqlNull, not `undefined`. Drizzle DROPS an undefined set-value, so
    // the plain version of this silently did nothing at all — the row kept
    // its banned_at and the user stayed banned, with no error anywhere.
    // This is the exact failure lib/sql/sql-null.ts was written to prevent, and
    // it still got written once before the docblock was taken seriously.
    .set({ bannedAt: orSqlNull(undefined), banReason: orSqlNull(undefined) })
    .where(eq(userProfiles.userId, userId));
  // The lift is recorded beside the ban it undoes.
  await db().batch([
    lift,
    moderationActionInsert(db(), {
      actorId: unbannedBy,
      action: "unban",
      subjectType: "profile",
      subjectId: userId,
      subjectOwnerId: userId,
      reason: "Reopened from the Desk",
    }),
    ...also(db()),
  ]);
}

/**
 * D-89's email (round 28 #8): "Your dialed.run account is open again.",
 * owed in the lift's batch like the ban's (task 126 wrote the template).
 * Keyed by the runner, so a second press replaces the debt.
 */
export function reopenEmail(userId: string): OutboxMessage {
  return emailDebt(
    { to: { userId }, template: { kind: "account_reopened" } },
    { dedupeKey: `account_reopened:${userId}` },
  );
}

export interface BanState {
  banned: boolean;
  reason: string | undefined;
  /**
  When, in epoch seconds — D4 dates the notice ("closed it on 16 September").
  */
  bannedAt: number | undefined;
}

/**
 * Whether this user is banned, and why.
 *
 * A user with no profile row is **not** banned. That is the right default:
 * the row is created during onboarding, so a brand-new account has none,
 * and failing closed here would lock out every first-time signup.
 */
export async function banStateOf(userId: string): Promise<BanState> {
  // The full row, not just the two ban columns: `userId` is the primary
  // key, so this is one row read whichever way it is written, and
  // `firstRowWhere` is the shared primary-key lookup the rest of this
  // module already leans on (see `lib/sql/keyed-read.ts`).
  const row = await firstRowWhere(
    db(),
    userProfiles,
    eq(userProfiles.userId, userId),
  );

  // `typeof !== "number"` rather than a null comparison: it covers both
  // "no profile row yet" and "row with no ban" in one test, and the repo
  // forbids the null literal (unicorn/no-null).
  if (typeof row?.bannedAt !== "number") {
    return { banned: false, reason: undefined, bannedAt: undefined };
  }
  return {
    banned: true,
    reason: row.banReason ?? undefined,
    bannedAt: row.bannedAt,
  };
}
