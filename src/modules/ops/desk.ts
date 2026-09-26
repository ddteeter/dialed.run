/**
 * The Desk's Today (Operator Screens D0) and the question that gates it.
 *
 * **Today and the digest read the same numbers from the same query**
 * (D5: "/desk renders the same three numbers from the same query, so Today
 * and the digest cannot disagree"). `runDailyDigest` calls `todayCounts`
 * for its review-queue line rather than asking the queue a second way.
 */
import { count, inArray, isNotNull, sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/d1";

import { reviewQueue, userProfiles } from "../../db/schema-core";
import { env } from "../../env";
import { nowSeconds } from "../../lib/now";
import { adminUserIds } from "../safety";

/**
Today's three numbers, and the two facts printed under them.
*/
export interface TodayCounts {
  /**
  Review rows nobody has decided: pending, or claimed and not finished.
  */
  readonly waiting: number;
  /**
  When the oldest of those arrived (epoch seconds), or null at zero.
  */
  readonly oldestWaitingAt: number | undefined;
  /**
  Of those, the ones the classifier sent rather than reporters.
  */
  readonly screenerUnfinished: number;
  readonly bansThisWeek: number;
  readonly bansAllTime: number;
}

const WEEK_SECONDS = 7 * 24 * 60 * 60;

/**
 * Today's counts, in one round trip.
 *
 * Grouped rather than one aggregate row: a grouped read answers with a row
 * per group that exists — at most two here — so "nothing waiting" is an
 * empty list rather than a row of zeros the code would have to trust is
 * there. Counting still happens in SQL; the Worker only adds two numbers.
 *
 * The review read rides the `review_queue_status_created` index on status.
 * The ban read scans `user_profiles`, which has no index on `banned_at`:
 * one row per runner, read once a day by the digest and when the operator
 * opens the Desk. An index is an additive migration this lane was not
 * listed for, so it is a register item rather than a change here.
 */
export async function todayCounts(): Promise<TodayCounts> {
  const db = drizzle(env.DIALED_CORE);
  const weekAgo = nowSeconds() - WEEK_SECONDS;
  const [review, bans] = await db.batch([
    db
      .select({
        source: reviewQueue.source,
        rows: count(),
        oldest: sql<number>`min(${reviewQueue.createdAt})`,
      })
      .from(reviewQueue)
      .where(inArray(reviewQueue.status, ["pending", "reviewing"]))
      .groupBy(reviewQueue.source),
    db
      .select({
        recent: sql<number>`${userProfiles.bannedAt} >= ${weekAgo}`,
        rows: count(),
      })
      .from(userProfiles)
      .where(isNotNull(userProfiles.bannedAt))
      .groupBy(sql`1`),
  ]);
  return {
    waiting: sumOf(review),
    oldestWaitingAt:
      review.length === 0
        ? undefined
        : Math.min(...review.map((g) => g.oldest)),
    screenerUnfinished:
      review.find((g) => g.source === "classifier")?.rows ?? 0,
    bansThisWeek: bans.find((g) => g.recent === 1)?.rows ?? 0,
    bansAllTime: sumOf(bans),
  };
}

function sumOf(groups: readonly { rows: number }[]): number {
  return groups.reduce((total, group) => total + group.rows, 0);
}

/**
 * Whether this viewer may see the Desk at all. Signed out and signed in
 * without the privilege get the same answer, because the route turns
 * "no" into not-found: the Desk is never linked, and a 403 would confirm
 * to a stranger that there is something here to be refused.
 */
export function isOperator(userId: string | undefined): boolean {
  // A set that admits `undefined` as a question, so a signed-out viewer is
  // asked the same way as a signed-in one rather than special-cased.
  return new Set<string | undefined>(adminUserIds()).has(userId);
}

/**
What the Desk's shell and Today render: the counts, as of when.
*/
export interface DeskToday {
  readonly counts: TodayCounts;
  /** Epoch seconds the counts were read at, so an age renders the same
   * on the server and after hydration. */
  readonly asOf: number;
}

export async function deskToday(): Promise<DeskToday> {
  return { counts: await todayCounts(), asOf: nowSeconds() };
}
