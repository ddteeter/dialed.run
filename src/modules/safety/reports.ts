/**
 * Report → hide → review (packet §2).
 *
 * Two hides, not one, and they are different mechanisms:
 *
 * - **Reporter-scoped, immediately.** W1 promises "The entry is hidden from
 *   your feed straight away, whatever we decide", and that promise is what
 *   makes filing a report cost the reporter nothing. It needs no column and
 *   no extra table: a row in `reports` *is* the hide, because the reader's
 *   own feed filters out subjects they have reported.
 * - **Global, at the threshold.** Three distinct reporters flips the
 *   subject to `hidden_pending_review` and queues it for a person. Nothing
 *   is removed and nothing is counted against anyone — the artboard's "no
 *   automated takedowns" stance holds, because a person still decides.
 */
import { and, eq, inArray } from "drizzle-orm";
import type { SQL } from "drizzle-orm";
import type { SQLiteColumn } from "drizzle-orm/sqlite-core";
import { drizzle } from "drizzle-orm/d1";

import { outfitEntries, reports, reviewQueue } from "../../db/schema-core";
import { env } from "../../env";
import { columnWhere, hasRowWhere } from "../../lib/keyed-read";
import { newUlid } from "../../lib/ids";

import {
  autoHideReporterThreshold,
  type ReportReason,
  type ReportSubjectType,
} from "./contracts";
import { enqueueForReview } from "./review";

function db() {
  return drizzle(env.DIALED_CORE);
}

export interface FileReportInput {
  reporterId: string;
  subjectType: ReportSubjectType;
  subjectId: string;
  reason: ReportReason;
  note?: string | undefined;
}

export interface FileReportResult {
  /**
  Distinct people who have now reported this subject.
  */
  reporterCount: number;
  /**
  Whether this report is what crossed the threshold.
  */
  hiddenPendingReview: boolean;
}

/**
 * Files a report, and hides the subject globally if this is the third
 * distinct person to object.
 *
 * **A repeat report is not an error.** Law 8b: a double-click, a replayed
 * POST and a retry over a flaky connection are indistinguishable from a
 * genuine second submission, and W1 gives the reporter no feedback that
 * would let them tell either. `onConflictDoNothing` against the UNIQUE
 * index makes the second one a no-op that still returns the truth about
 * where the subject stands.
 */
export async function fileReport(
  input: FileReportInput,
): Promise<FileReportResult> {
  await db()
    .insert(reports)
    .values({
      id: newUlid(),
      reporterId: input.reporterId,
      subjectType: input.subjectType,
      subjectId: input.subjectId,
      reason: input.reason,
      // Omitted rather than an explicit NULL: on an INSERT drizzle stores
      // NULL for an absent nullable column, so `?? null` would only be
      // ceremony. (On an UPDATE it would matter — see lib/sql-null.)
      note: input.note,
      createdAt: Math.floor(Date.now() / 1000),
    })
    // The UNIQUE index is on (reporter, subjectType, subjectId), so this
    // drops a second report of the same thing by the same person. That is
    // what makes the count below a count of people rather than of clicks.
    .onConflictDoNothing();

  const reporterCount = await distinctReporterCount(
    input.subjectType,
    input.subjectId,
  );

  if (reporterCount < autoHideReporterThreshold) {
    return { reporterCount, hiddenPendingReview: false };
  }

  await hidePendingReview(input.subjectType, input.subjectId);
  return { reporterCount, hiddenPendingReview: true };
}

/**
 * The predicate every subject-keyed read shares: this type, this id.
 *
 * Three reads were building it inline — the reporter count, the queue
 * lookup, and the hide — and a clone detector is right that they are one
 * idea. The columns stay arguments for the reason `lib/keyed-read.ts`
 * gives: which column a query touches decides whether SQLite answers from
 * an index, and D1 bills rows scanned, so that choice stays visible at the
 * call site rather than being picked by a helper.
 */
function subjectMatches(
  typeColumn: SQLiteColumn,
  idColumn: SQLiteColumn,
  subjectType: ReportSubjectType,
  subjectId: string,
): SQL | undefined {
  return and(eq(typeColumn, subjectType), eq(idColumn, subjectId));
}

/**
 * How many distinct people have reported this subject.
 *
 * Reads `reporter_id` alone, which the `reports_subject` index does not
 * carry — but the alternative is `select *`, and D1 bills rows scanned.
 * The count is small by construction: a subject with enough reports to
 * matter is already hidden and already in front of a person.
 */
export async function distinctReporterCount(
  subjectType: ReportSubjectType,
  subjectId: string,
): Promise<number> {
  const reporters = await columnWhere(
    db(),
    reports,
    reports.reporterId,
    subjectMatches(reports.subjectType, reports.subjectId, subjectType, subjectId),
  );
  // The UNIQUE index already guarantees one row per reporter, so the row
  // count *is* the distinct count. Deduplicating here as well would be a
  // second answer to a question the schema has already settled.
  return reporters.length;
}

/**
 * "This person reported something of this type" — the other predicate this
 * table is read by, named for symmetry with `subjectMatches`.
 */
function reportedBy(
  reporterId: string,
  subjectType: ReportSubjectType,
): SQL | undefined {
  return and(
    eq(reports.reporterId, reporterId),
    eq(reports.subjectType, subjectType),
  );
}

/**
 * The subject ids this viewer has reported, so their own feed can drop them
 * — W1's "hidden from your feed straight away".
 *
 * Returns ids for one subject type at a time because the caller is always
 * filtering one list: a feed of entries, a grid of photos. Mixing types
 * would hand the caller a set it has to re-filter.
 */
export async function reportedSubjectIdsFor(
  reporterId: string,
  subjectType: ReportSubjectType,
): Promise<string[]> {
  return columnWhere(db(), reports, reports.subjectId, reportedBy(reporterId, subjectType));
}

/**
 * Flips the subject out of public view and puts it in front of a person.
 *
 * **One batch** (CLAUDE.md: two writes in one handler go in one batch
 * unless you can say why they are independent). These are the worst case
 * the rule names — a state change plus the record that authorises acting on
 * it. A gap between them leaves a subject hidden with nothing queued, which
 * is a silent permanent takedown: exactly the outcome the artboard's stance
 * forbids.
 *
 * `profile` has no moderation column of its own — a reported profile is a
 * ban decision, which is a person's call, so it queues without hiding
 * anything. `photo` and `product` are wired as their owning lanes' columns
 * come under this module's reads.
 */
async function hidePendingReview(
  subjectType: ReportSubjectType,
  subjectId: string,
): Promise<void> {
  const queueWrite = enqueueForReview(db(), {
    subjectType,
    subjectId,
    source: "reports",
  });

  if (subjectType !== "entry") {
    await db().batch([queueWrite]);
    return;
  }

  await db().batch([
    db()
      .update(outfitEntries)
      .set({ moderationStatus: "hidden_pending_review" })
      .where(eq(outfitEntries.id, subjectId)),
    queueWrite,
  ]);
}

/**
 * Whether this subject is already waiting on a person — used by the review
 * page and by tests, so "queued" is observable rather than inferred from
 * the side effects of queueing.
 */
export async function isQueuedForReview(
  subjectType: ReportSubjectType,
  subjectId: string,
): Promise<boolean> {
  // The open-status test is an `inArray` in the WHERE, not a `.some()`
  // afterwards. CLAUDE.md's D1 discipline is explicit — a filter a WHERE
  // could have expressed is billed for every row it scanned and threw
  // away — and `hasRowWhere` adds the LIMIT 1 that stops at the first
  // match instead of reading every row of a subject's history to answer
  // yes or no.
  return hasRowWhere(
    db(),
    reviewQueue,
    reviewQueue.status,
    and(
      subjectMatches(
        reviewQueue.subjectType,
        reviewQueue.subjectId,
        subjectType,
        subjectId,
      ),
      inArray(reviewQueue.status, ["pending", "reviewing"]),
    ),
  );
}
