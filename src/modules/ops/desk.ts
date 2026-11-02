/**
 * The Desk's Today (Operator Screens D0) and the question that gates it.
 *
 * **Today and the digest read "waiting" from the same function** (D5:
 * "/desk renders the same three numbers from the same query, so Today and
 * the digest cannot disagree"): safety's `pendingReviewCount`, the one
 * definition of it. The digest needs only that number, so it calls that
 * alone rather than all of Today.
 */
import { and, asc, count, eq, inArray, isNotNull, sql } from "drizzle-orm";

import { user } from "../../db/schema-auth";
import {
  cronCheckpoints,
  gaveUp,
  reviewQueue,
  userProfiles,
} from "../../db/schema-core";
import { coreDb } from "../../env";
import { calendarDay } from "../../lib/dates";
import { nowSeconds } from "../../lib/now";
import { maskedAddress } from "../email";
import {
  adminUserIds,
  overCeilings,
  pendingReviewCount,
  type CeilingReading,
} from "../safety";
import { DIGEST_UNCONFIRMED } from "./digest-marks";

/**
Today's three numbers, and the two facts printed under them.
*/
export interface TodayCounts {
  /**
   * Review rows waiting for a decision, as safety counts them: `pending`.
   * A claimed row (`reviewing`) is someone's in-hand work, and a claim
   * nobody finishes returns to `pending` within the lease.
   */
  readonly waiting: number;
  /**
  When the oldest of those arrived (epoch seconds); absent at zero.
  */
  readonly oldestWaitingAt: number | undefined;
  /**
  Of those, the ones the classifier sent rather than reporters.
  */
  readonly screenerUnfinished: number;
  readonly bansThisWeek: number;
  readonly bansAllTime: number;
  /**
   * Jobs the system stopped retrying (Gave up, a section of Today; R-119):
   * Today's rail count and the digest's one extra line.
   */
  readonly gaveUp: number;
  /**
  When the longest-standing of those first failed; absent at zero.
  */
  readonly oldestGaveUpAt: number | undefined;
  /**
   * When a morning's digest last skipped an operator whose address is not
   * confirmed (OPS-11, `DIGEST_UNCONFIRMED`); absent if one never has.
   * Today says so while it is today's.
   */
  readonly digestUnconfirmedAt: number | undefined;
}

const WEEK_SECONDS = 7 * 24 * 60 * 60;

/**
 * Today's counts: "waiting" from safety, the rest in one round trip.
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
  const db = coreDb();
  const weekAgo = nowSeconds() - WEEK_SECONDS;
  const waiting = await pendingReviewCount();
  const [review, bans, gave, unconfirmed] = await db.batch([
    db
      .select({
        source: reviewQueue.source,
        rows: count(),
        oldest: sql<number>`min(${reviewQueue.createdAt})`,
      })
      .from(reviewQueue)
      .where(eq(reviewQueue.status, "pending"))
      .groupBy(reviewQueue.source),
    db
      .select({
        recent: sql<number>`${userProfiles.bannedAt} >= ${weekAgo}`,
        rows: count(),
      })
      .from(userProfiles)
      .where(isNotNull(userProfiles.bannedAt))
      .groupBy(sql`1`),
    // Grouped by a constant (not `1`, which would name the count), so an
    // empty table is no row rather than a NULL oldest. A scan of
    // `gave_up`, which holds only what is still owed an operator: retried
    // and dropped rows leave it.
    db
      .select({
        rows: count(),
        oldest: sql<number>`min(${gaveUp.firstFailedAt})`,
      })
      .from(gaveUp)
      .groupBy(sql`'gave_up'`),
    // The digest's skip mark, by its primary key (OPS-11).
    db
      .select({ at: cronCheckpoints.lastRunAt })
      .from(cronCheckpoints)
      .where(eq(cronCheckpoints.cronName, DIGEST_UNCONFIRMED)),
  ]);
  const [gaveUpGroup] = gave;
  return {
    waiting,
    oldestWaitingAt:
      review.length === 0
        ? undefined
        : Math.min(...review.map((g) => g.oldest)),
    screenerUnfinished:
      review.find((g) => g.source === "classifier")?.rows ?? 0,
    bansThisWeek: bans.find((g) => g.recent === 1)?.rows ?? 0,
    bansAllTime: sumOf(bans),
    gaveUp: gaveUpGroup?.rows ?? 0,
    oldestGaveUpAt: gaveUpGroup?.oldest,
    digestUnconfirmedAt: unconfirmed[0]?.at,
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
 * An operator today's digest skipped (round 38 #62b): their runner handle,
 * as the Desk names every account, and their address masked as round 27
 * masks one, so they know which inbox to confirm.
 */
export interface SkippedOperator {
  readonly userId: string;
  readonly handle: string | undefined;
  readonly address: string;
}

/**
What the Desk's shell and Today render: the counts, as of when.
*/
export interface DeskToday {
  readonly counts: TodayCounts;
  /** Epoch seconds the counts were read at, so an age renders the same
   * on the server and after hydration. */
  readonly asOf: number;
  /**
   * Who today's digest skipped, one line each on Today; empty on a day it
   * skipped nobody, in UTC like the date above it.
   */
  readonly skipped: readonly SkippedOperator[];
  /**
   * Each hold breaker at its ceiling this hour (design 164), one line each
   * on Today; empty on an ordinary hour.
   */
  readonly breakers: readonly CeilingReading[];
}

/**
 * The operators whose address is still not confirmed: who the digest
 * skipped, read the way it decided (`confirmedOf`), with no record of its
 * own. One who confirms later that day drops off the line early, which is
 * what the line asks of them.
 */
async function unconfirmedOperators(): Promise<readonly SkippedOperator[]> {
  const operatorIds = [...adminUserIds()];
  const unconfirmed = and(
    inArray(user.id, operatorIds),
    eq(user.emailVerified, false),
  );
  // The handle is a scalar subquery rather than a join: an operator with no
  // profile row still appears, with a null handle, either way.
  const handleOf = sql<string | null>`(select ${userProfiles.username} from ${userProfiles} where ${userProfiles.userId} = ${user.id})`;
  const rows = await coreDb()
    .select({ userId: user.id, handle: handleOf, email: user.email })
    .from(user)
    .where(unconfirmed)
    .orderBy(asc(user.id));
  return rows.map((row) => ({
    userId: row.userId,
    handle: row.handle ?? undefined,
    address: maskedAddress(row.email),
  }));
}

export async function deskToday(): Promise<DeskToday> {
  const counts = await todayCounts();
  const asOf = nowSeconds();
  const at = counts.digestUnconfirmedAt;
  // Only on the day the digest skipped someone: tomorrow's tries again.
  const isToday = at !== undefined && calendarDay(at) === calendarDay(asOf);
  return {
    counts,
    asOf,
    skipped: isToday ? await unconfirmedOperators() : [],
    breakers: await overCeilings(coreDb(), asOf),
  };
}
