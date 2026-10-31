/**
 * The hold breakers (design 164; owner, 2026-10-31): how many things an
 * automated check may hide in an hour before it stops hiding them.
 *
 * Three checks hide with no person involved: a fingerprint match on upload
 * (D-147), a classifier flag, and the report threshold. A bug in any of
 * them, or a change in the model behind the classifier, would hide
 * runners' photos in bulk. Over its ceiling a check falls back to what the
 * app already does when that part is degraded, so a bug hides a bounded
 * number an hour rather than everything. That fallback is the caller's.
 *
 * **No state.** Each reading counts the last hour from the rows the holds
 * already write, as `/takedown`'s valve does (`takedown-limits.ts`): the
 * breaker resets itself when the hour drains, and nothing needs switching
 * back on. The reads are not a lock, so two holds landing together can
 * both pass at the edge — one past the ceiling, which a person reviews.
 *
 * Each ceiling scales with what drives its cause:
 * - fingerprint: re-uploads of removed images, which do not grow with
 *   traffic, so a fixed number;
 * - classifier: uploads, so a share of the hour's screenings;
 * - reports: people, so a multiple of the busiest hour of the last four
 *   weeks, never under a floor.
 */
import { and, count, desc, eq, gte, lt, sql } from "drizzle-orm";
import type { drizzle } from "drizzle-orm/d1";

import { photoScreenings, reviewQueue } from "../../db/schema-core";
import { counted } from "./takedown-limits";

type Db = ReturnType<typeof drizzle>;

/**
Why a row is in Review, read from the column: each is a cause with its own ceiling.
*/
export type HoldCause = (typeof reviewQueue.$inferSelect)["source"];

const HOUR_S = 60 * 60;

/**
Fingerprint holds in an hour at which the next match is screened instead.
*/
export const FINGERPRINT_HOLDS_PER_HOUR = 5;

/**
 * The share of an hour's screenings flagged past which the next flag
 * leaves its photo `pending` instead, and the fewest screenings the share
 * is read from: under it, two flags of five is a bad hour, not a bug.
 */
export const CLASSIFIER_FLAG_SHARE = 0.15;
export const CLASSIFIER_FEWEST_SCREENED = 20;

/**
 * Report hides in an hour at which the next only queues: never fewer than
 * the floor, and otherwise this many times the busiest hour of the
 * baseline weeks.
 */
export const REPORT_HIDES_FLOOR = 10;
export const REPORT_HIDES_OVER_BUSIEST = 4;
export const REPORT_BASELINE_S = 28 * 24 * HOUR_S;

/**
 * Whether a cause's hour is at its ceiling, and the numbers that say so:
 * what the alert and the digest's headroom line name.
 */
export interface CeilingReading {
  readonly cause: HoldCause;
  readonly isOver: boolean;
  /**
  Holds this hour; for the classifier, flags.
  */
  readonly count: number;
  /**
  The count at which the cause stops holding.
  */
  readonly ceiling: number;
}

/**
 * The classifier's ceiling for an hour of `screened` screenings: the
 * share of them, rounded up, and never reachable under the fewest.
 */
export function classifierCeiling(screened: number): number {
  if (screened < CLASSIFIER_FEWEST_SCREENED) return Infinity;
  return Math.ceil(screened * CLASSIFIER_FLAG_SHARE);
}

/**
The reports' ceiling, given the busiest hour of the baseline weeks.
*/
export function reportCeiling(busiestHour: number): number {
  return Math.max(REPORT_HIDES_FLOOR, REPORT_HIDES_OVER_BUSIEST * busiestHour);
}

/**
 * Reads a cause's last hour against its ceiling. The reports' baseline is
 * read only once the hour is past the floor, so the ordinary hour costs
 * one count.
 */
export async function ceilingReading(
  db: Db,
  cause: HoldCause,
  now: number,
): Promise<CeilingReading> {
  const since = now - HOUR_S;
  if (cause === "classifier") {
    const { flagged, screened } = await screenedSince(db, since);
    const ceiling = classifierCeiling(screened);
    return { cause, isOver: flagged >= ceiling, count: flagged, ceiling };
  }
  const held = await openedSince(db, cause, since);
  const ceiling =
    cause === "fingerprint"
      ? FINGERPRINT_HOLDS_PER_HOUR
      : await reportsCeilingFor(db, held, now);
  return { cause, isOver: held >= ceiling, count: held, ceiling };
}

/**
 * Every cause at its ceiling this hour: what the hourly alert (one Sentry
 * event a cause a day) and Today's line name. Empty on an ordinary hour.
 */
export async function overCeilings(
  db: Db,
  now: number,
): Promise<readonly CeilingReading[]> {
  const readings = await Promise.all(
    reviewQueue.source.enumValues.map((cause) =>
      ceilingReading(db, cause, now),
    ),
  );
  return readings.filter((reading) => reading.isOver);
}

/**
 * The reports' ceiling: the floor while the hour is under it, which is
 * every ordinary hour, and otherwise the baseline's.
 */
async function reportsCeilingFor(
  db: Db,
  held: number,
  now: number,
): Promise<number> {
  if (held < REPORT_HIDES_FLOOR) return REPORT_HIDES_FLOOR;
  return reportCeiling(await busiestHourBefore(db, "reports", now - HOUR_S));
}

/**
How many rows of a cause went in front of a person since `since`.
*/
async function openedSince(
  db: Db,
  cause: HoldCause,
  since: number,
): Promise<number> {
  const rows = await db
    .select({ n: count() })
    .from(reviewQueue)
    .where(and(eq(reviewQueue.source, cause), gte(reviewQueue.openedAt, since)));
  return counted(rows);
}

/**
 * The most rows of a cause opened in any one hour of the baseline weeks
 * before `until`: what an ordinary busy hour looks like. Zero with none.
 */
async function busiestHourBefore(
  db: Db,
  cause: HoldCause,
  until: number,
): Promise<number> {
  const opened = reviewQueue.openedAt;
  const hour = sql`${opened} / ${HOUR_S}`;
  const rows = await db
    .select({ n: count() })
    .from(reviewQueue)
    .where(
      and(
        eq(reviewQueue.source, cause),
        gte(opened, until - REPORT_BASELINE_S),
        lt(opened, until),
      ),
    )
    .groupBy(hour)
    .orderBy(desc(count()))
    .limit(1);
  return counted(rows);
}

/**
How many photos were screened since `since`, and how many of them flagged.
*/
async function screenedSince(
  db: Db,
  since: number,
): Promise<{ flagged: number; screened: number }> {
  const flag = eq(photoScreenings.decision, "flag");
  const rows = await db
    .select({
      n: count(),
      flagged: sql<number>`sum(${flag})`.mapWith(Number),
    })
    .from(photoScreenings)
    .where(gte(photoScreenings.createdAt, since));
  const flagged = rows.reduce((total, row) => total + row.flagged, 0);
  return { flagged, screened: counted(rows) };
}
