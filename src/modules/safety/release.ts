/**
 * Releasing a burst of holds (design 164): Approve, at once, every hold of
 * one cause still waiting that went in front of a person since a time.
 *
 * The breakers bound how many photos a bug can hide in an hour; this is
 * the undo for the hours before anyone noticed. Each row goes through
 * `resolveReview` exactly as one Approve does — its own batch, the
 * reviewer stamped on it, the subject back where an Approve puts it, and
 * whoever an Approve tells, told — so a release is many decisions, not a
 * new kind of one.
 *
 * **Bounded a press.** `RELEASE_BATCH` rows, oldest first, and the answer
 * says whether more wait; the operator presses again. Each row is a few
 * statements, and a request has a ceiling on how many it may make.
 */
import { and, asc, count, eq, gte, inArray, type SQL } from "drizzle-orm";

import { reviewQueue } from "../../db/schema-core";
import { coreDb } from "../../env";
import type { HoldCause } from "../../lib/contracts/hold-causes";
import { nowSeconds } from "../../lib/now";
import { claimForReview, resolveReview } from "./review";

/**
 * A row still waiting on a decision: pending, or claimed by a tab that
 * has not decided. Read both, so the count is what is waiting; the claim
 * below takes only a pending one, and a claim past its lease is put back
 * to pending by the hourly sweep (`releaseStaleClaims`).
 */
function openSince(since: number, ...also: readonly SQL[]) {
  return and(
    gte(reviewQueue.openedAt, since),
    inArray(reviewQueue.status, ["pending", "reviewing"]),
    ...also,
  );
}

/**
Rows released a press.
*/
export const RELEASE_BATCH = 50;

export interface ReleaseOutcome {
  /**
  How many this press approved.
  */
  readonly released: number;
  /**
  Whether more of that cause, since that time, are still waiting.
  */
  readonly hasMore: boolean;
}

/**
 * One more than a press releases, oldest first, so the caller can tell
 * whether more wait without a second count.
 */
function oldestWaiting(cause: HoldCause, since: number) {
  return coreDb()
    .select({ id: reviewQueue.id })
    .from(reviewQueue)
    .where(openSince(since, eq(reviewQueue.source, cause)))
    .orderBy(asc(reviewQueue.openedAt), asc(reviewQueue.id))
    .limit(RELEASE_BATCH + 1);
}

/**
 * Approves the oldest `RELEASE_BATCH` waiting holds of `cause` opened at
 * or after `since`, as `reviewerId`. A row another tab holds a claim on,
 * or decided in the meantime, is left to it, and not counted.
 */
export async function releaseHolds(
  cause: HoldCause,
  since: number,
  reviewerId: string,
): Promise<ReleaseOutcome> {
  const waiting = await oldestWaiting(cause, since);
  let released = 0;
  for (const { id } of waiting.slice(0, RELEASE_BATCH)) {
    // Claimed first (law 2), as the Review page does: a row a tab took in
    // the meantime is that tab's to decide.
    if ((await claimForReview(id, reviewerId)) !== "claimed") continue;
    await resolveReview(id, reviewerId, "approve");
    released += 1;
  }
  return { released, hasMore: waiting.length > RELEASE_BATCH };
}

/**
 * How far back Review offers to release: the last day, which covers a
 * night nobody was looking (design 164).
 */
export const RELEASE_WINDOW_S = 24 * 60 * 60;

/**
One cause's holds still waiting since a time: what Review offers to release.
*/
export interface WaitingHolds {
  readonly cause: HoldCause;
  readonly waiting: number;
}

/**
 * Each cause with holds still waiting that were opened at or after
 * `since`, and how many. A cause with none is not listed: a grouped count
 * answers a row only for a group that exists.
 */
export async function waitingHoldsSince(
  since: number,
): Promise<readonly WaitingHolds[]> {
  return coreDb()
    .select({ cause: reviewQueue.source, waiting: count() })
    .from(reviewQueue)
    .where(openSince(since))
    .groupBy(reviewQueue.source)
    .orderBy(asc(reviewQueue.source));
}

/**
 * What Review's release section reads (design 164): each cause's holds
 * still waiting from the last day, and the time that day starts, which a
 * release is then asked about so it names exactly what was counted.
 */
export async function burstsToRelease(): Promise<{
  bursts: readonly WaitingHolds[];
  burstsSince: number;
}> {
  const burstsSince = nowSeconds() - RELEASE_WINDOW_S;
  return { bursts: await waitingHoldsSince(burstsSince), burstsSince };
}
