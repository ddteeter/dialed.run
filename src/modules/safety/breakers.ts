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
import {
  and,
  count,
  desc,
  eq,
  gte,
  inArray,
  lt,
  lte,
  ne,
  sql,
} from "drizzle-orm";
import type { SQL } from "drizzle-orm";
import type { drizzle } from "drizzle-orm/d1";

import { photoScreenings, reviewQueue } from "../../db/schema-core";
import { HOLD_CAUSES, type HoldCause } from "../../lib/contracts/hold-causes";
import { reportSubjectsThatHide } from "./contracts";
import { counted } from "./takedown-limits";

type Db = ReturnType<typeof drizzle>;

export type { HoldCause } from "../../lib/contracts/hold-causes";

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
  return screened < CLASSIFIER_FEWEST_SCREENED
    ? Infinity
    : Math.ceil(screened * CLASSIFIER_FLAG_SHARE);
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
  if (cause === "classifier") return classifierReadingAt(db, now);
  const held = await openedSince(db, cause, now - HOUR_S);
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
    HOLD_CAUSES.map((cause) => ceilingReading(db, cause, now)),
  );
  return readings.filter((reading) => reading.isOver);
}

/**
 * How far back the hourly alert looks for a trip (R-172): two firings'
 * worth, so a burst that straddles the top of an hour is inside one look.
 * Looking twice at one trip is harmless, because the alert's issue is one
 * a cause a day.
 */
export const TRIP_LOOKBACK_S = 2 * HOUR_S;

/**
 * Every cause whose breaker reached its ceiling at some point from `from`
 * up to `now` (R-172): what the hourly alert names. A reading on the hour
 * alone misses a burst split across two hours, because each hour holds
 * half of it.
 *
 * The rows the holds already write say when the ceiling was reached:
 * - fingerprint and reports: the busiest sliding hour of Review rows;
 * - classifier: a flag it held back is the breaker refusing, so the
 *   reading is the one it took then, and otherwise the one now.
 */
export async function tripsSince(
  db: Db,
  from: number,
  now: number,
): Promise<readonly CeilingReading[]> {
  const readings = await Promise.all(
    HOLD_CAUSES.map((cause) => busiestReading(db, cause, from, now)),
  );
  return readings.filter((reading) => reading.isOver);
}

/**
A cause's highest reading from `from` up to `now`.
*/
async function busiestReading(
  db: Db,
  cause: HoldCause,
  from: number,
  now: number,
): Promise<CeilingReading> {
  if (cause === "classifier") {
    return classifierReadingAt(db, await lastRefusalOr(db, from, now));
  }
  const held = await busiestSlidingHour(db, cause, from, now);
  const ceiling =
    cause === "fingerprint"
      ? FINGERPRINT_HOLDS_PER_HOUR
      : await reportsCeilingFor(db, held, from);
  return { cause, isOver: held >= ceiling, count: held, ceiling };
}

/**
 * The classifier's reading as its breaker took it at `at`: the hour up to
 * and including `at`, nothing screened after it.
 */
async function classifierReadingAt(
  db: Db,
  at: number,
): Promise<CeilingReading> {
  const { flagged, screened } = await screenedIn(db, at - HOUR_S, at);
  const ceiling = classifierCeiling(screened);
  return {
    cause: "classifier",
    isOver: flagged >= ceiling,
    count: flagged,
    ceiling,
  };
}

/**
 * When the classifier breaker last held a flag back from `from` up to
 * `now`, or `now` when it held none back.
 */
async function lastRefusalOr(
  db: Db,
  from: number,
  now: number,
): Promise<number> {
  const at = photoScreenings.createdAt;
  const heldBack = eq(photoScreenings.decision, "held_back");
  const [latest] = await db
    .select({ at })
    .from(photoScreenings)
    .where(screenedWithin(heldBack, from, now))
    .orderBy(desc(at))
    .limit(1);
  return latest?.at ?? now;
}

/**
 * The most rows of a cause opened inside any one hour that ends from
 * `from` up to `now` (not including it: the next look covers that
 * second), each hour as a breaker reads it at a hold: that hold and every
 * one in the hour before it. The rows are read back to an
 * hour before `from`, so the first hours counted are whole. They are few:
 * the breakers bound them.
 */
async function busiestSlidingHour(
  db: Db,
  cause: HoldCause,
  from: number,
  now: number,
): Promise<number> {
  const opened = reviewQueue.openedAt;
  const rows = await db
    .select({
      at: sql<number>`${opened}`,
      inHour: sql<number>`count(*) over (order by ${opened} range between ${sql.raw(String(HOUR_S))} preceding and current row)`,
    })
    .from(reviewQueue)
    .where(openedIn(cause, from - HOUR_S, now));
  let peak = 0;
  for (const row of rows) {
    if (row.at >= from) peak = Math.max(peak, row.inHour);
  }
  return peak;
}

/**
 * The share of its ceiling a cause's busiest hour reached, at which the
 * digest says so (design 164): the ceilings are fixed numbers or rules,
 * and this is what tells a person to revisit one before growth trips it.
 */
export const HEADROOM_WARN_SHARE = 0.5;
const DAY_S = 24 * HOUR_S;

/**
How close a cause's busiest hour came to its ceiling, as a share of it.
*/
export interface Headroom {
  readonly cause: HoldCause;
  readonly used: number;
}

/**
 * Each cause's busiest hour of the last day, as a share of its ceiling:
 * the digest's daily headroom read. A day, not a week, because the digest
 * reads every morning and a week would say one busy hour seven times.
 * The reports' ceiling is the one their baseline set going into the day.
 */
export async function dayHeadroom(
  db: Db,
  now: number,
): Promise<readonly Headroom[]> {
  const from = now - DAY_S;
  const [holds, reportsHeld, reportsCeiling, flagShare] = await Promise.all([
    busiestHourIn(db, "fingerprint", from, now),
    busiestHourIn(db, "reports", from, now),
    reportsCeilingBefore(db, from),
    busiestFlagShareIn(db, from, now),
  ]);
  return [
    { cause: "fingerprint", used: holds / FINGERPRINT_HOLDS_PER_HOUR },
    { cause: "classifier", used: flagShare / CLASSIFIER_FLAG_SHARE },
    { cause: "reports", used: reportsHeld / reportsCeiling },
  ];
}

/**
 * The screenings that are verdicts: all but a flag the breaker held back,
 * which hid nothing and would otherwise lower the share that held it.
 */
const verdicts = ne(photoScreenings.decision, "held_back");

/**
 * The largest share of an hour's screenings flagged, among hours with
 * enough screenings to read a share from. Zero with none.
 */
async function busiestFlagShareIn(
  db: Db,
  from: number,
  until: number,
): Promise<number> {
  const at = photoScreenings.createdAt;
  const flag = eq(photoScreenings.decision, "flag");
  const share = sql<number>`1.0 * sum(${flag}) / count(*)`.mapWith(Number);
  const rows = await db
    .select({ share })
    .from(photoScreenings)
    .where(and(verdicts, gte(at, from), lt(at, until)))
    .groupBy(sql`${at} / ${HOUR_S}`)
    .having(gte(count(), CLASSIFIER_FEWEST_SCREENED))
    .orderBy(desc(share))
    .limit(1);
  return Math.max(0, ...rows.map((row) => row.share));
}

/**
 * The fewest screenings in a week from which no flag and no review is
 * worth saying (design 164): what a change of model in the direction the
 * breaker cannot see looks like.
 */
export const QUIET_FEWEST_SCREENED = 50;
const WEEK_S = 7 * DAY_S;

/**
 * How many photos the last week screened, when that is enough to read
 * and none of them was flagged or sent to review; nothing otherwise.
 */
export async function quietScreenerWeek(
  db: Db,
  now: number,
): Promise<number | undefined> {
  const at = photoScreenings.createdAt;
  const passed = sql<number>`sum(${photoScreenings.decision} = 'pass')`;
  const rows = await db
    .select({ n: count(), passed: passed.mapWith(Number) })
    .from(photoScreenings)
    .where(gte(at, now - WEEK_S));
  const screened = counted(rows);
  const allPassed = rows.reduce((total, row) => total + row.passed, 0);
  return allPassed === screened && screened >= QUIET_FEWEST_SCREENED
    ? screened
    : undefined;
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
  return held < REPORT_HIDES_FLOOR
    ? REPORT_HIDES_FLOOR
    : reportsCeilingBefore(db, now - HOUR_S);
}

/**
The reports' ceiling from the baseline weeks before `until`.
*/
async function reportsCeilingBefore(db: Db, until: number): Promise<number> {
  const from = until - REPORT_BASELINE_S;
  return reportCeiling(await busiestHourIn(db, "reports", from, until));
}

/**
 * The Review rows a cause's breaker counts: every row it opened, except
 * that reports count only on the subjects a report can hide (owner,
 * 2026-10-31), so a pile-on of profile reports cannot pause post hides.
 */
function heldBy(cause: HoldCause): SQL | undefined {
  const opened = eq(reviewQueue.source, cause);
  return cause === "reports"
    ? and(opened, inArray(reviewQueue.subjectType, reportSubjectsThatHide))
    : opened;
}

/**
The rows of a cause opened from `from` up to, not including, `until`.
*/
function openedIn(
  cause: HoldCause,
  from: number,
  until: number,
): SQL | undefined {
  const opened = reviewQueue.openedAt;
  return and(heldBy(cause), gte(opened, from), lt(opened, until));
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
    .where(and(heldBy(cause), gte(reviewQueue.openedAt, since)));
  return counted(rows);
}

/**
 * The most rows of a cause opened in any one hour from `from` up to
 * `until`: what a busy hour looks like. Zero with none.
 */
async function busiestHourIn(
  db: Db,
  cause: HoldCause,
  from: number,
  until: number,
): Promise<number> {
  const opened = reviewQueue.openedAt;
  const hour = sql`${opened} / ${HOUR_S}`;
  const rows = await db
    .select({ n: count() })
    .from(reviewQueue)
    .where(openedIn(cause, from, until))
    .groupBy(hour)
    .orderBy(desc(count()))
    .limit(1);
  return counted(rows);
}

/**
The screenings matching `which` made from `since` up to and including `until`.
*/
function screenedWithin(
  which: SQL,
  since: number,
  until: number,
): SQL | undefined {
  const at = photoScreenings.createdAt;
  return and(which, gte(at, since), lte(at, until));
}

/**
 * How many photos were screened from `since` up to `until`, and how many
 * of them flagged.
 */
async function screenedIn(
  db: Db,
  since: number,
  until: number,
): Promise<{ flagged: number; screened: number }> {
  const flag = eq(photoScreenings.decision, "flag");
  const rows = await db
    .select({
      n: count(),
      flagged: sql<number>`sum(${flag})`.mapWith(Number),
    })
    .from(photoScreenings)
    .where(screenedWithin(verdicts, since, until));
  const flagged = rows.reduce((total, row) => total + row.flagged, 0);
  return { flagged, screened: counted(rows) };
}
