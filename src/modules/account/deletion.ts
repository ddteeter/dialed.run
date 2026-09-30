/**
 * Deleting an account (task 126, ACC-9; round 27 #14): the request, the
 * week in which the runner can keep it, and what each page says about it.
 * The purge that ends the week is `./purge.ts`.
 *
 * **At request, one batch**: the claim in `account_deletions`, every
 * session gone, and the "delete scheduled" email owed (law 8c). Nothing
 * about the runner's entries is written: they leave the feed, profiles,
 * search and the Call through safety's one visibility rule, which reads
 * the claim — so keeping the account brings everything back exactly as
 * it was. Strava is disconnected straight after, through runs'
 * `disconnectStrava` (seam 5); the purge repeats it for a connection
 * that outlived a failure here.
 */
import { and, eq, isNull } from "drizzle-orm";
import { drizzle } from "drizzle-orm/d1";

import { session } from "../../db/schema-auth";
import { accountDeletions } from "../../db/schema-core";
import { env, waitUntil } from "../../env";
import { DELETION_GRACE_S } from "../../lib/contracts";
import { proseDayLabel } from "../../lib/dates";
import { firstRowWhere } from "../../lib/keyed-read";
import { nowSeconds } from "../../lib/now";
import type { PasswordCheck } from "../auth";
import { emailDebt } from "../email";
import {
  captureException,
  outboxInsert,
  oweOutbox,
  settleOutbox,
} from "../ops";
import { disconnectStrava } from "../runs";
import { ownAccountView } from "./account-view";
import type { OwedMail } from "./verification";

type Db = ReturnType<typeof drizzle>;

/**
 * How recent a Google sign-in must be to stand in for a password (round
 * 27 #14: "Google-only: the field is replaced by 'Continue with Google'
 * to re-authenticate").
 */
export const FRESH_SIGN_IN_S = 10 * 60;

export type DeletionResult =
  | { readonly status: "scheduled"; readonly purgeAfter: number }
  | { readonly status: "wrong-password" }
  | { readonly status: "password-limited"; readonly until: number }
  | { readonly status: "reauth" };

export interface DeletionRequest {
  readonly userId: string;
  /**
  What the sheet's field held — absent for an account with no password.
  */
  readonly currentPassword: string | undefined;
  /**
   * Whether it is this account's password, within the limit on tries —
   * `auth`'s `checkCurrentPassword`, wired by the server function.
   */
  readonly checkPassword: (password: string) => Promise<PasswordCheck>;
  /**
  When this request's session was made, in epoch seconds.
  */
  readonly signedInAt: number;
}

export interface DeletionEffects extends OwedMail {
  /**
  Runs' `disconnectStrava`, bound to the queue: the grant revoked (seam 5).
  */
  readonly disconnectStrava: (userId: string) => Promise<void>;
}

/**
 * The platform's side of a request: the Worker kept alive for the email,
 * sent through the outbox's fast path, and Strava disconnected through
 * runs' own primitive.
 */
export function deletionEffectsFromEnv(): DeletionEffects {
  return {
    keepAlive: waitUntil,
    report: captureException,
    settle: settleOutbox,
    disconnectStrava: (userId) =>
      disconnectStrava(
        drizzle(env.DIALED_CORE),
        env.IMPORTS_QUEUE,
        userId,
        captureException,
      ),
  };
}

/**
 * The day a deletion lands, as the email and both pages of the week say
 * it — **in UTC, on purpose**. A profile carries no time zone to say it in
 * (a run's zone is the run's own, D-96), and the purge runs on the daily
 * firing, which is scheduled in UTC. `proseDayLabel` with no zone is UTC;
 * passing the string would say the same thing and leave a mutant no input
 * could tell apart. The delete sheet says its day the same way.
 */
function deletionDay(epochSeconds: number): string {
  return proseDayLabel(epochSeconds);
}

/**
 * The proof a deletion needs: the current password, or — for an account
 * made with Google, which has none — a Google sign-in within the last ten
 * minutes. `undefined` when it is proved.
 */
async function refusal(
  db: Db,
  request: DeletionRequest,
  now: number,
): Promise<Exclude<DeletionResult, { status: "scheduled" }> | undefined> {
  const { hasPassword } = await ownAccountView(db, request.userId);
  if (!hasPassword) {
    const age = now - request.signedInAt;
    return age <= FRESH_SIGN_IN_S ? undefined : { status: "reauth" };
  }
  const check = await request.checkPassword(request.currentPassword ?? "");
  if (check.status === "own") return undefined;
  return check.status === "wrong"
    ? { status: "wrong-password" }
    : { status: "password-limited", until: check.until };
}

/**
 * Ask for the account to be deleted. A second request keeps the first
 * one's date: the claim is written once, and the email says the date the
 * claim holds.
 */
export async function requestAccountDeletion(
  db: Db,
  request: DeletionRequest,
  effects: DeletionEffects,
  now = nowSeconds(),
): Promise<DeletionResult> {
  const refused = await refusal(db, request, now);
  if (refused !== undefined) return refused;
  const { userId } = request;
  const existing = await pendingDeletionOf(db, userId);
  const purgeAfter = existing?.purgeAfter ?? now + DELETION_GRACE_S;
  const day = deletionDay(purgeAfter);
  const debt = oweOutbox(
    emailDebt(
      { to: { userId }, template: { kind: "deletion_scheduled", day } },
      { dedupeKey: `deletion_scheduled:${userId}:${String(purgeAfter)}` },
    ),
  );
  await db.batch([
    db
      .insert(accountDeletions)
      .values({ userId, requestedAt: now, purgeAfter })
      // Untargeted: the primary key is the table's only unique constraint,
      // so the one conflict there can be is this runner's earlier claim.
      .onConflictDoNothing(),
    // "You're signed out on every device" — deleted rather than expired,
    // as a ban does: a deleted session cannot be got wrong by anybody.
    db.delete(session).where(eq(session.userId, userId)),
    outboxInsert(db, debt, now),
  ]);
  effects.keepAlive(effects.settle(db, debt, effects.report));
  // Secondary to the request (law 5): a failure here is reported, and the
  // purge disconnects whatever is still connected.
  try {
    await effects.disconnectStrava(userId);
  } catch (error) {
    effects.report(error, { surface: "account-deletion-strava", userId });
  }
  return { status: "scheduled", purgeAfter };
}

/**
The runner's pending deletion, if they have one.
*/
export async function pendingDeletionOf(
  db: Db,
  userId: string,
): Promise<{ purgeAfter: number } | undefined> {
  const row = await firstRowWhere(
    db,
    accountDeletions,
    eq(accountDeletions.userId, userId),
  );
  return row === undefined ? undefined : { purgeAfter: row.purgeAfter };
}

export type KeepResult = "kept" | "too-late";

/**
 * "Keep my account": the claim deleted, and with it every hide — but only
 * while the purge has not started (law 2: once claimed, the purge owns
 * it). No claim at all is kept already.
 */
export async function keepAccount(db: Db, userId: string): Promise<KeepResult> {
  const mine = eq(accountDeletions.userId, userId);
  const unclaimed = and(mine, isNull(accountDeletions.purgeStartedAt));
  // One batch: the read sees exactly what the delete left, so a claim
  // still there is one the purge had already started on.
  const [, left] = await db.batch([
    db.delete(accountDeletions).where(unclaimed),
    db
      .select({ userId: accountDeletions.userId })
      .from(accountDeletions)
      .where(mine),
  ]);
  return left.length === 0 ? "kept" : "too-late";
}

/**
 * What `/account/leaving` shows (round 27 #14): "Keep your account?" to a
 * runner signed in inside the week; "Your account goes on …" to the one
 * who just asked, now signed out, with the date the request answered; and
 * nothing to anyone else.
 */
export type LeavingView =
  | { readonly state: "ask"; readonly day: string }
  | { readonly state: "scheduled"; readonly day: string }
  | { readonly state: "none" };

export async function leavingView(
  db: Db,
  userId: string | undefined,
  on: number | undefined,
): Promise<LeavingView> {
  if (userId !== undefined) {
    const pending = await pendingDeletionOf(db, userId);
    return pending === undefined
      ? { state: "none" }
      : { state: "ask", day: deletionDay(pending.purgeAfter) };
  }
  return on === undefined
    ? { state: "none" }
    : { state: "scheduled", day: deletionDay(on) };
}
