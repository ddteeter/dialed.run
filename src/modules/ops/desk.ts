/**
 * The Desk's Today (Operator Screens D0) and the question that gates it.
 *
 * **Today and the digest read "waiting" from the same function** (D5:
 * "/desk renders the same three numbers from the same query, so Today and
 * the digest cannot disagree"): safety's `pendingReviewCount`, the one
 * definition of it. The digest needs only that number, so it calls that
 * alone rather than all of Today.
 */
import { and, asc, count, eq, gte, inArray, isNotNull, sql } from "drizzle-orm";

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
  flaggedCountOf,
  overCeilings,
  pendingReviewCount,
  stuckSources,
  type CeilingReading,
} from "../safety";
import type { CronName } from "./crons";
import { DIGEST_UNCONFIRMED } from "./digest-marks";
import { stillDueOf } from "./outbox";

/**
Today's three numbers, the two facts printed under them, and the lines
that show only above zero.
*/
export interface TodayCounts {
  /**
   * Review rows waiting for a decision, as safety counts them: `pending`.
   * A claimed row (`reviewing`) is someone's in-hand work, and a claim
   * nobody finishes returns to `pending` within the lease.
   */
  readonly waiting: number;
  /**
   * Review rows approved or removed since midnight UTC, the day `calendarDay`
   * reads: Review's header prints it beside `waiting` (round 44 #106), from
   * this one value so the header and the rail cannot disagree.
   */
  readonly decidedToday: number;
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
   * Accounts flagged after an intimate-image removal and not yet decided
   * (D-161 1): Today's fourth number, shown at 0 (R47·125).
   */
  readonly flaggedAccounts: number;
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
  /**
   * Outbox rows that were due when the last daily digest started and are
   * due still: what its drain could not reach (design 168). A line on
   * Today and in the digest, only above zero; never a fourth number.
   */
  readonly outboxBehind: number;
  /**
  When the longest-waiting of those fell due; absent at zero.
  */
  readonly oldestBehindAt: number | undefined;
}

const DIGEST_CRON: CronName = "daily-digest";

/**
 * The outbox rows the last daily digest's drain could not reach, by kind
 * (design 168). Bounded by the digest's heartbeat, which its firing writes
 * before anything else, so a row due by then was due when the drain read
 * the table — and not by `now`: most kinds drain only in the digest, so a
 * row due since is the schedule, not a backlog. Before the first digest
 * the bound is NULL and nothing is behind. Exported for the test that
 * reads its plan.
 */
export function outboxBehindOf(db: ReturnType<typeof coreDb>) {
  return stillDueOf(
    db,
    sql<number>`(select ${cronCheckpoints.lastRunAt} from ${cronCheckpoints} where ${cronCheckpoints.cronName} = ${DIGEST_CRON})`,
  );
}

/**
 * Review rows decided since `since`: approved or removed, `resolved_at`
 * being when. Grouped by a constant, as gave_up's read is, so none decided
 * is no row.
 */
function decidedSinceOf(db: ReturnType<typeof coreDb>, since: number) {
  const decided = and(
    inArray(reviewQueue.status, ["approved", "removed"]),
    gte(reviewQueue.resolvedAt, since),
  );
  return db
    .select({ rows: count() })
    .from(reviewQueue)
    .where(decided)
    .groupBy(sql`'decided'`);
}

/**
 * Closed accounts, grouped by whether `weekAgo` or later closed them. It
 * reads only the banned rows, through the partial `user_profiles_banned_at`
 * index (PR#112-1), not every runner. Exported for the test that reads its
 * plan.
 */
export function banCountsOf(db: ReturnType<typeof coreDb>, weekAgo: number) {
  return db
    .select({
      recent: sql<number>`${userProfiles.bannedAt} >= ${weekAgo}`,
      rows: count(),
    })
    .from(userProfiles)
    .where(isNotNull(userProfiles.bannedAt))
    .groupBy(sql`1`);
}

const DAY_SECONDS = 24 * 60 * 60;
const WEEK_SECONDS = 7 * DAY_SECONDS;

/**
 * The queue sources Today counts as "photos the screener couldn't
 * finish": what it flagged, and what it never screened at all (D-157).
 */
const screenerSources: ReadonlySet<string> = new Set([
  "classifier",
  ...stuckSources,
]);

/**
 * Today's counts: "waiting" from safety, the rest in one round trip.
 *
 * Grouped rather than one aggregate row: a grouped read answers with a row
 * per group that exists — at most two here — so "nothing waiting" is an
 * empty list rather than a row of zeros the code would have to trust is
 * there. Counting still happens in SQL; the Worker only adds two numbers.
 *
 * The review read rides the `review_queue_status_created` index on status,
 * and the ban read `user_profiles_banned_at` (`banCountsOf`).
 */
export async function todayCounts(): Promise<TodayCounts> {
  const db = coreDb();
  const now = nowSeconds();
  const weekAgo = now - WEEK_SECONDS;
  const dayStart = now - (now % DAY_SECONDS);
  const waiting = await pendingReviewCount();
  const [review, bans, flagged, gave, unconfirmed, behind, decided] =
    await db.batch([
      db
        .select({
          source: reviewQueue.source,
          rows: count(),
          oldest: sql<number>`min(${reviewQueue.createdAt})`,
        })
        .from(reviewQueue)
        .where(eq(reviewQueue.status, "pending"))
        .groupBy(reviewQueue.source),
      banCountsOf(db, weekAgo),
      flaggedCountOf(db),
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
      outboxBehindOf(db),
      decidedSinceOf(db, dayStart),
    ]);
  const [gaveUpGroup] = gave;
  return {
    waiting,
    decidedToday: sumOf(decided),
    oldestWaitingAt:
      review.length === 0
        ? undefined
        : Math.min(...review.map((g) => g.oldest)),
    // What the screener sent, and what it never finished: a photo still
    // pending a day after upload (D-157) is exactly "a photo the screener
    // couldn't finish", and hidden until someone looks.
    screenerUnfinished: sumOf(
      review.filter((g) => screenerSources.has(g.source)),
    ),
    bansThisWeek: bans.find((g) => g.recent === 1)?.rows ?? 0,
    bansAllTime: sumOf(bans),
    flaggedAccounts: sumOf(flagged),
    gaveUp: gaveUpGroup?.rows ?? 0,
    oldestGaveUpAt: gaveUpGroup?.oldest,
    digestUnconfirmedAt: unconfirmed[0]?.at,
    outboxBehind: sumOf(behind),
    oldestBehindAt:
      behind.length === 0
        ? undefined
        : Math.min(...behind.map((g) => g.oldest ?? Infinity)),
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
  const handleOf = sql<
    string | null
  >`(select ${userProfiles.username} from ${userProfiles} where ${userProfiles.userId} = ${user.id})`;
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
