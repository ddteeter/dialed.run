/**
 * `requireUserId`'s whole decision (task 126, ACC-6 and ACC-9; round 28
 * PR A), with the session handed in — so it can be imported by a test,
 * which `./require-user` cannot (it reads TanStack's request).
 *
 * **Gated by function, never by request method** (review of PR #140).
 * The gate used to let a `GET` through as a read and treat anything else
 * as a write. Neither half holds: TanStack's default method is `GET`, not
 * `POST`, and during a server render the request is the *page's* `GET`, so
 * a `POST` function a loader calls (`onboarding/done` →
 * `completeOnboardingFn`, the Strava callback → `completeStravaConnectFn`)
 * walked straight past it. So the method is never read. Every server
 * function that calls `requireUserId` needs the current terms, reads and
 * writes alike — the leaving gate's rule, one rule rather than a list of
 * which functions write. A runner behind on the terms reaches nothing
 * through it, which costs them nothing: the root's gate already shows them
 * the prompt in front of every page, and a stale tab's refused call opens
 * it too (decision D-96).
 *
 * **The exempt are named, by calling something else**:
 * `requireUserIdBeforeTerms` for Accept itself, Get a copy (D-95: data
 * portability never waits on new terms), and the two reads Settings ›
 * Account loads, where Delete account is; `requireSignedInSince` and
 * `checkCurrentPassword` for Delete account; `requireUserIdWhileLeaving`
 * for Keep. Sign-out is Better Auth's own endpoint and never passes
 * through here. `test/architecture/terms-exempt.test.ts` holds that list
 * against the code, both ways.
 *
 * **One round trip.** The leaving claim and the latest acceptance are two
 * seeks, read in one `db.batch()` rather than one after the other behind
 * the session's own read.
 *
 * **The verification gate is this one plus the address** (design 133,
 * decision D-113): `confirmedUserId`, behind `verifiedUserId`, reads the
 * confirmation as a third seek in the same batch, so it costs no round
 * trip. Refusal order: no session, leaving, behind on the terms,
 * unconfirmed — a runner behind on the terms sees the terms prompt first,
 * because confirming would not let them through anyway.
 */
import type { drizzle } from "drizzle-orm/d1";

import {
  currentTermsVersion,
  emailConfirmationRead,
  latestAcceptanceOf,
  termsStandingOf,
} from "../account";
import {
  AccountLeavingError,
  EmailUnconfirmedError,
  TermsNotAcceptedError,
} from "./auth-error";
import { deletionClaimOf, standingFrom } from "./leaving-gate";
import { userIdOrThrow, type SessionWithUser } from "./session-user";

type Db = ReturnType<typeof drizzle>;

/**
 * The refusals both gates share, from the rows they read: leaving, then
 * behind on the terms.
 */
function refuseUnlessAgreed(
  claim: Parameters<typeof standingFrom>[0],
  latest: number | undefined,
  current: number | undefined,
): void {
  if (standingFrom(claim) !== "active") throw new AccountLeavingError();
  if (termsStandingOf(latest, current).state === "behind") {
    throw new TermsNotAcceptedError();
  }
}

/**
 * The signed-in runner's id — or `AuthRequiredError` with no session,
 * `AccountLeavingError` for an account set to be deleted, and
 * `TermsNotAcceptedError` for a runner behind on the published terms.
 * `current` is the published version, `undefined` while none is (D-93),
 * when nobody is behind.
 */
export async function agreedUserId(
  db: Db,
  session: SessionWithUser | null,
  current: number | undefined = currentTermsVersion(),
): Promise<string> {
  const userId = userIdOrThrow(session);
  const [[claim], [latest]] = await db.batch([
    deletionClaimOf(db, userId),
    latestAcceptanceOf(db, userId),
  ]);
  refuseUnlessAgreed(claim, latest?.version, current);
  return userId;
}

/**
 * `agreedUserId`, and then `EmailUnconfirmedError` for a runner whose
 * address is not confirmed — or who has no account row, which is a runner
 * who is gone (`account`'s `isVerified` reads it the same way).
 * `verifiedUserId`'s whole decision.
 */
export async function confirmedUserId(
  db: Db,
  session: SessionWithUser | null,
  current: number | undefined = currentTermsVersion(),
): Promise<string> {
  const userId = userIdOrThrow(session);
  const [[claim], [latest], [confirmation]] = await db.batch([
    deletionClaimOf(db, userId),
    latestAcceptanceOf(db, userId),
    emailConfirmationRead(db, userId),
  ]);
  refuseUnlessAgreed(claim, latest?.version, current);
  if (confirmation?.isConfirmed !== true) throw new EmailUnconfirmedError();
  return userId;
}
