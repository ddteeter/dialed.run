/**
 * The 3-year sweep (D-131, plan C7, design 150): takedown requests,
 * reports and the records of moderation decisions are kept for 3 years
 * after the decision, then deleted. Quarantined material keeps its own
 * clock (`retain_until`, `quarantine.ts`), which this never touches.
 *
 * Run by the daily firing (`ops/scheduled.ts`), beside the other sweeps.
 */
import {
  and,
  eq,
  gte,
  inArray,
  isNull,
  lt,
  notExists,
  or,
  sql,
  type SQL,
} from "drizzle-orm";
import type { drizzle } from "drizzle-orm/d1";
import type { SQLiteTable } from "drizzle-orm/sqlite-core";

import {
  copyrightHolds,
  moderationActions,
  quarantinedContent,
  reports,
  reviewQueue,
  takedownRequests,
} from "../../db/schema-core";
import { coreDb } from "../../env";
import { nowSeconds } from "../../lib/now";

import { reportsOnQueueRow } from "./reports";

type Db = ReturnType<typeof drizzle>;

/**
 * Three years, as 3 × 365 days and one more, so that no record goes before
 * three calendar years have passed, whichever of them holds a leap day.
 * D-131's reason is the DMCA's three-year limitations period: a day short
 * is a day the record might be wanted and gone.
 */
export const MODERATION_RECORD_KEPT_SECONDS = (3 * 365 + 1) * 24 * 60 * 60;

/**
 * "No row of `table` matches `where`", as a `NOT EXISTS`: each delete
 * below keeps a row that something else still names or still needs.
 */
function noRow(db: Db, table: SQLiteTable, where: SQL | undefined) {
  return notExists(
    db
      .select({ one: sql`1` })
      .from(table)
      .where(where),
  );
}

/**
 * "The subject's review is open, or was decided at or after `cutoff`": the
 * review row that still makes a report on the subject worth keeping. An
 * open row (pending or reviewing) has no `resolved_at`; every decision
 * writes one, and re-opening clears it (`enqueueForReview`).
 */
function reviewStillCounts(cutoff: number) {
  const open = isNull(reviewQueue.resolvedAt);
  return or(open, gte(reviewQueue.resolvedAt, cutoff));
}

/**
 * A report's clock is the later of its filing and its subject's decision.
 * One that never reached a person runs from its filing.
 */
function expiredReports(db: Db, cutoff: number) {
  const keptByReview = and(reportsOnQueueRow(), reviewStillCounts(cutoff));
  const filedBefore = lt(reports.createdAt, cutoff);
  return and(filedBefore, noRow(db, reviewQueue, keptByReview));
}

/**
 * A review row is the only record of an Approve. It stays while any report
 * is left on its subject: without it, three reports and no row is what
 * `reconcileUnhiddenReports` hides and queues again.
 */
function expiredReviews(db: Db, cutoff: number) {
  const decidedBefore = lt(reviewQueue.resolvedAt, cutoff);
  return and(decidedBefore, noRow(db, reports, reportsOnQueueRow()));
}

/**
 * Only a settled hold. A `hidden` one is live: inside its 30 days, waiting
 * on a counter-notice's restore, or held for a court case (D-146), and it
 * has no `settled_at` until the Desk ends the case. A `purging` one carries
 * the purge's lease in `settled_at`, not a decision. Neither is ever swept,
 * however old.
 */
function expiredHolds(cutoff: number) {
  const settled = inArray(copyrightHolds.status, ["restored", "purged"]);
  return and(settled, lt(copyrightHolds.settledAt, cutoff));
}

/**
 * An audit row stays while a hold or a quarantine record names it: the
 * hold reads its notice and actor, and the quarantine its preserved
 * object. It goes with its hold, or after the quarantine's purge.
 */
function expiredActions(db: Db, cutoff: number) {
  const action = moderationActions.id;
  const hold = eq(copyrightHolds.moderationActionId, action);
  const quarantine = eq(quarantinedContent.moderationActionId, action);
  return and(
    lt(moderationActions.createdAt, cutoff),
    noRow(db, copyrightHolds, hold),
    noRow(db, quarantinedContent, quarantine),
  );
}

/**
 * The five deletes, in the order they must run, for one batch. Exported so
 * each plan can be asked of SQLite (D1 bills rows scanned).
 *
 * Order matters twice: the review rows go only once their subject has no
 * report left, so the reports go first; and an audit row goes only once no
 * hold names it, so the holds go first. In one batch, each statement sees
 * what the ones before it deleted.
 */
export function moderationRecordDeletes(db: Db, cutoff: number) {
  return [
    // A request's decision is its `resolved_at`, written only by Remove or
    // Decline; a pending one has none and is never swept.
    db.delete(takedownRequests).where(lt(takedownRequests.resolvedAt, cutoff)),
    db.delete(reports).where(expiredReports(db, cutoff)),
    db.delete(reviewQueue).where(expiredReviews(db, cutoff)),
    db.delete(copyrightHolds).where(expiredHolds(cutoff)),
    db.delete(moderationActions).where(expiredActions(db, cutoff)),
  ] as const;
}

/**
 * Delete what D-131's 3 years have run out on. One batch, because two of
 * its statements read what earlier ones left. Re-runnable (law 1): it
 * deletes past a fixed line, so a second pass finds nothing. A row exactly
 * on the line is kept: three years is not more than three years.
 */
export async function sweepModerationRecords(
  db: Db = coreDb(),
  now = nowSeconds(),
): Promise<void> {
  await db.batch(
    moderationRecordDeletes(db, now - MODERATION_RECORD_KEPT_SECONDS),
  );
}
