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
import {
  and,
  countDistinct,
  eq,
  gte,
  inArray,
  isNotNull,
  isNull,
  ne,
  or,
  sql,
} from "drizzle-orm";
import type { SQL } from "drizzle-orm";
import type { BatchItem } from "drizzle-orm/batch";
import type { SQLiteColumn } from "drizzle-orm/sqlite-core";

import {
  entryPhotos,
  outfitEntries,
  reports,
  reviewQueue,
} from "../../../db/schema-core";
import { coreDb } from "../../../env";
import type { PurgeTags } from "../../../lib/cache-tags";
import { columnWhere, hasRowWhere } from "../../../lib/sql/keyed-read";
import { newUlid } from "../../../lib/ids";
import { nowSeconds } from "../../../lib/now";

import {
  operatorEmailMessage,
  type OutboxMessage,
} from "../../../lib/sql/outbox";
import {
  hiddenByReport,
  REMOVAL_DUE_SECONDS,
  reasonsOnTheClock,
  STORED_REPORT_REASONS,
  type ReportReason,
  type ReportSubjectType,
} from "../rules";
import { adminUserIds } from "../rules";
import {
  fewestReportersToHide,
  moderationThresholds,
  reportersToHide,
  type ModerationThresholds,
} from "../screening";
import { blockRunner } from "./blocks";
import { ceilingReading } from "../limits";
import { subjectCacheTagsOf } from "../rules";
import { hiddenNotice, reporterIdsOf } from "../notices";
import { enqueueForReview, firstReportHidingAtOnce } from "../review";
import { heldPhotoStatus } from "../rules";
import { isWithinAtOnceLimit, reportRefusalOf } from "./reportable";

/**
 * Owes an outbox row in the caller's batch — the operators' removal alert
 * (design 136). `ops`' `outboxInsert`, handed in by the server function and
 * the hourly firing, since `ops` imports this module and so cannot be
 * imported by it (the runs consumer's `owe`, for the same reason).
 */
export type OweEmail = (message: OutboxMessage) => BatchItem<"sqlite">;

/**
 * One alert per operator that `subjectId` was hidden as an intimate image
 * shared without consent, due 48 hours after `reportedAt` (design 136,
 * D-117). Nothing for a subject a report cannot hide, or when no operator
 * is configured.
 */
function removalAlerts(
  owe: OweEmail,
  subjectType: ReportSubjectType,
  subjectId: string,
  reportedAt: number,
): BatchItem<"sqlite">[] {
  const subject = hiddenByReport[subjectType];
  if (subject === undefined) return [];
  // An operator's mail, drained ahead of every other email (design 232).
  return adminUserIds().map((userId) =>
    owe(
      operatorEmailMessage(
        {
          to: { userId },
          template: {
            kind: "removal_due",
            subject,
            dueAt: reportedAt + REMOVAL_DUE_SECONDS,
          },
        },
        `removal_due:${subjectType}:${subjectId}:${userId}`,
      ),
    ),
  );
}

function db() {
  return coreDb();
}

export interface FileReportInput {
  reporterId: string;
  subjectType: ReportSubjectType;
  subjectId: string;
  reason: ReportReason;
  note?: string | undefined;
  /**
   * W1's "Block them as well". Handled here rather than by the caller, for
   * two reasons: a route file may not branch (`server-functions-are-glue`
   * forbids it, and a decision there is one no test can reach), and
   * blocking-with-a-report is one intent that should not be able to
   * half-happen.
   */
  alsoBlock?: boolean | undefined;
}

/**
 * What filing answered (design 232): `filed`, with where the subject
 * stands; `not_found`, a subject that does not exist or the reporter
 * cannot see, which writes nothing; `limited`, past the reporter's
 * reports for the day, which writes nothing either.
 */
export type FileReportResult =
  | {
      readonly status: "filed";
      /**
      Distinct people who have now reported this subject.
      */
      reporterCount: number;
      /**
      Whether this report is what crossed the threshold.
      */
      hiddenPendingReview: boolean;
    }
  | { readonly status: "not_found" }
  | { readonly status: "limited" };

/**
 * Files a report, and hides the subject globally if this is the third
 * distinct person to object.
 *
 * **A repeat report is not an error.** Law 8b: a double-click, a replayed
 * POST and a retry over a flaky connection are indistinguishable from a
 * genuine second submission, and W1 gives the reporter no feedback that
 * would let them tell either. `onConflictDoNothing` against the UNIQUE
 * index makes the second one a no-op that still returns the truth about
 * where the subject stands: a call that added no reporter hides nothing,
 * re-opens nothing and owes nothing (SA-M21), so a decision a person made
 * on the subject stands against the same reporter's repeat.
 *
 * **It names something the reporter can see** (SA-M10): a subject that
 * does not exist, or a kit that is neither theirs nor shared, is
 * `not_found` and writes nothing. And it is counted: past
 * `REPORTS_PER_DAY` a call is `limited`, and past `AT_ONCE_HIDES_PER_DAY`
 * a reason that hides at once is filed and queued for a person (with its
 * alert) but hides nothing.
 *
 * **It waits for a confirmed address** (round 26 #11; SAF-15, seam 7):
 * report is one of the things that "trusts the address". The
 * distinct-reporter threshold counts accounts, and an address nobody has
 * confirmed costs nothing to make — three of them would be a takedown on
 * demand. So an unconfirmed reporter is refused before anything is
 * written, the block a report may carry included — by the server
 * function's gate, `verifiedUserId` (design 133, D-113), before this runs.
 */
export async function fileReport(
  input: FileReportInput,
  owe: OweEmail,
  purge: PurgeTags,
): Promise<FileReportResult> {
  const repeat = await repeatOf(input);
  if (repeat !== undefined) return repeat;
  const refused = await reportRefusalOf(db(), input, nowSeconds());
  if (refused !== undefined) return { status: refused };
  const database = db();
  const reportedAt = nowSeconds();
  const added = await database
    .insert(reports)
    .values({
      id: newUlid(),
      reporterId: input.reporterId,
      subjectType: input.subjectType,
      subjectId: input.subjectId,
      reason: input.reason,
      // Omitted rather than an explicit NULL: on an INSERT drizzle stores
      // NULL for an absent nullable column, so `?? null` would only be
      // ceremony. (On an UPDATE it would matter — see lib/sql/sql-null.)
      note: input.note,
      createdAt: reportedAt,
    })
    // The UNIQUE index is on (reporter, subjectType, subjectId), so this
    // drops a second report of the same thing by the same person. That is
    // what makes the count below a count of people rather than of clicks.
    .onConflictDoNothing()
    .returning({ id: reports.id });

  // Only a profile can be blocked — a report against an entry names the
  // entry, and blocking its author would need a lookup the reporter never
  // asked for. W1 offers the checkbox only where there is somebody to
  // block, and `blockRunner` is the same rule on the write side: it blocks
  // only an id with a profile (design 232), so a kit's id blocks nothing.
  if (input.alsoBlock === true) {
    await blockRunner(input.reporterId, input.subjectId);
  }

  const filed = await filedReasonsOf(input.subjectType, input.subjectId);
  const reporterCount = filed.length;

  // A repeat adds nobody, so it changes nothing (SA-M21): the hourly
  // sweep still finishes a hide a crash left undone, by its own marker.
  // The reasons set the bar (design 136, D-117), and the bar is config
  // (`./thresholds`), one person when it is missing: the lowest bar of
  // the reasons filed, whatever order they came in (design 232), which is
  // the sweep's rule too.
  if (
    added.length === 0 ||
    reporterCount < fewestReportersToHide(filed, moderationThresholds())
  ) {
    return { status: "filed", reporterCount, hiddenPendingReview: false };
  }

  const isAtOnce = reasonsOnTheClock.includes(input.reason);
  const alerts = isAtOnce
    ? removalAlerts(owe, input.subjectType, input.subjectId, reportedAt)
    : [];
  const canHide = isAtOnce
    ? await isWithinAtOnceLimit(database, input.reporterId, reportedAt)
    : await canHideNow(false, reportedAt);
  await hidePendingReview(input.subjectType, input.subjectId, alerts, purge, {
    canHide,
    isAtOnce,
    heldTo: stillOverTheBar(input.subjectType, input.subjectId),
  });
  return { status: "filed", reporterCount, hiddenPendingReview: canHide };
}

/**
 * A report this reporter already filed on this subject, answered as the
 * first was answered, whatever has changed since: a replay of a report
 * that also blocked its subject is not refused for the block it made,
 * and nothing is counted, hidden or re-opened (law 8b).
 */
async function repeatOf(
  input: FileReportInput,
): Promise<FileReportResult | undefined> {
  const isRepeat = await hasRowWhere(
    db(),
    reports,
    reports.id,
    and(
      eq(reports.reporterId, input.reporterId),
      eq(reports.subjectType, input.subjectType),
      eq(reports.subjectId, input.subjectId),
    ),
  );
  if (!isRepeat) return undefined;
  const filed = await filedReasonsOf(input.subjectType, input.subjectId);
  return {
    status: "filed",
    reporterCount: filed.length,
    hiddenPendingReview: false,
  };
}

export interface ReconcileReport {
  /**
  Subjects found over the threshold with no decision recorded.
  */
  found: number;
  /**
   * Of those, the ones this sweep hid and queued. Past the report
   * breaker's ceiling the rest only queue (design 164).
   */
  hidden: number;
}

/**
 * Hides anything that crossed the report threshold and never got hidden
 * (law 8c, the reconciliation half).
 *
 * **The hole this closes.** `fileReport` inserts the report, counts the
 * reporters, and only then hides — three statements with two gaps, and D1
 * has no transaction spanning them. A worker that dies in either gap
 * leaves the third report durably written and the entry still visible,
 * with nothing to re-drive it: the count is derived, so nothing anywhere
 * is wearing a "not finished" marker. Raised on PR #73, and correct — the
 * window is small and the consequence is the one thing this lane exists to
 * prevent.
 *
 * **The marker is the queue row, not a new column.** `hidePendingReview`
 * writes the queue row and the hide in a single batch, so a subject with a
 * queue row is a subject whose hide landed. Using its absence as the
 * signal also gets the case that matters most right for free: a subject a
 * reviewer has already *approved* keeps its row, so this never re-hides
 * something a person deliberately let stand.
 *
 * Bounded, like every other sweep here: this runs hourly beside the
 * screening retry, and a backlog that cannot be cleared in one firing is
 * cleared over several.
 */
export async function reconcileUnhiddenReports(
  owe: OweEmail,
  purge: PurgeTags,
  limit = 50,
): Promise<ReconcileReport> {
  const database = db();
  // The first report of a reason that hides at once (design 136), or NULL
  // when there is none: both the second way over the bar and the time the
  // removal's 48 hours started.
  const firstAtOnce = firstReportHidingAtOnce();
  // Over by count: as many reporters as the lowest bar among the reasons
  // actually filed on the subject, as `fileReport` asks (design 232). A
  // reason on the clock is over at its first report, as above.
  const enoughReporters = gte(
    countDistinct(reports.reporterId),
    lowestFiledBar(moderationThresholds()),
  );
  const over = await database
    .select({
      subjectType: reports.subjectType,
      subjectId: reports.subjectId,
      firstAtOnce,
    })
    .from(reports)
    .leftJoin(reviewQueue, reportsOnQueueRow())
    // Only subjects nothing has decided on. Filtered in SQL rather than
    // after the fact, so D1 is not billed for scanning every settled
    // subject this app will ever accumulate.
    .where(isNull(reviewQueue.id))
    .groupBy(reports.subjectType, reports.subjectId)
    .having(or(enoughReporters, isNotNull(firstAtOnce)))
    .limit(limit);

  const outcome: ReconcileReport = { found: over.length, hidden: 0 };
  const now = nowSeconds();
  for (const row of over) {
    // The hide and its alerts are one batch, so a subject found unhidden
    // was never alerted either: owe both now.
    const alerts =
      row.firstAtOnce === null
        ? []
        : removalAlerts(owe, row.subjectType, row.subjectId, row.firstAtOnce);
    const isAtOnce = row.firstAtOnce !== null;
    const canHide = await canHideNow(isAtOnce, now);
    await hidePendingReview(row.subjectType, row.subjectId, alerts, purge, {
      canHide,
      isAtOnce,
    });
    // Queued is reconciled either way: its row is the marker, so the
    // sweep never comes back to hide what the breaker held back.
    if (canHide) outcome.hidden += 1;
  }
  return outcome;
}

/**
 * The lowest bar among a group's filed reasons, as SQL for a `HAVING`
 * over `reports`: each stored reason's bar from the config, spelt into a
 * `CASE` (they are integers the config parsed, not input).
 */
function lowestFiledBar(thresholds: ModerationThresholds | undefined): SQL {
  const bars = STORED_REPORT_REASONS.map((reason) => {
    const bar = sql.raw(String(reportersToHide(reason, thresholds)));
    return sql`when ${reason} then ${bar}`;
  });
  const between = sql` `;
  return sql`min(case ${reports.reason} ${sql.join(bars, between)} end)`;
}

/**
 * The reasons filed on a subject since a person last approved it, one a
 * reporter (the UNIQUE index), so its length is the distinct reporter
 * count. A report from before that Approve was answered by it, so only
 * the reports after it count toward hiding the subject again (owner,
 * 2026-11-21); a subject never approved counts every report.
 */
async function filedReasonsOf(
  subjectType: ReportSubjectType,
  subjectId: string,
): Promise<ReportReason[]> {
  const onSubject = subjectMatches(
    reports.subjectType,
    reports.subjectId,
    subjectType,
    subjectId,
  );
  return columnWhere(
    db(),
    reports,
    reports.reason,
    and(onSubject, sinceLastApproved()),
  );
}

/**
 * A report filed since the last Approve of its subject's Review row, or
 * any report when there was none. Its own second included: times are in
 * whole seconds, and a report in the Approve's second may not have been
 * on the page that approved it.
 */
function sinceLastApproved(): SQL {
  const lastApproved = sql`(select ${reviewQueue.approvedAt} from ${reviewQueue} where ${reportsOnQueueRow()})`;
  return sql`${reports.createdAt} >= coalesce(${lastApproved}, 0)`;
}

/**
 * `fileReport`'s bar, asked again as its batch runs: the reports filed
 * since the subject was last approved still number at least the lowest
 * bar among their reasons. An Approve that lands after the count answers
 * the reports before it, so a report it leaves under the bar re-opens and
 * hides nothing, as if it had been filed a moment later.
 */
function stillOverTheBar(
  subjectType: ReportSubjectType,
  subjectId: string,
): SQL {
  const onSubject = subjectMatches(
    reports.subjectType,
    reports.subjectId,
    subjectType,
    subjectId,
  );
  const since = and(onSubject, sinceLastApproved());
  // One aggregate row however many reports: no report since leaves the
  // bar NULL, which `coalesce` reads as under it.
  const overTheBar = sql`${countDistinct(reports.reporterId)} >= ${lowestFiledBar(moderationThresholds())}`;
  return sql`coalesce((select ${overTheBar} from ${reports} where ${since}), 0)`;
}

/**
 * The join condition between a queue row and the reports filed on its
 * subject: same type, same id. The reconcile sweep and the removal reminder
 * each join the two this way; the join kind (left or inner) stays the
 * caller's, because it decides which rows survive.
 */
export function reportsOnQueueRow(): SQL | undefined {
  return and(
    eq(reviewQueue.subjectType, reports.subjectType),
    eq(reviewQueue.subjectId, reports.subjectId),
  );
}

/**
 * The predicate every subject-keyed read shares: this type, this id.
 *
 * Three reads were building it inline — the reporter count, the queue
 * lookup, and the hide — and a clone detector is right that they are one
 * idea. The columns stay arguments for the reason `lib/sql/keyed-read.ts`
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
  const reporters = await reporterIdsOf(db(), subjectType, subjectId);
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
  return columnWhere(
    db(),
    reports,
    reports.subjectId,
    reportedBy(reporterId, subjectType),
  );
}

/**
 * Whether a report may hide its subject now (design 164): always for a
 * reason that hides at once — an intimate image's 48 hours, and the harm
 * of one more viewer, outweigh a burst on a path a person files one at a
 * time (owner, 2026-10-31) — and otherwise while the report breaker has
 * room this hour.
 */
async function canHideNow(isAtOnce: boolean, now: number): Promise<boolean> {
  if (isAtOnce) return true;
  const reading = await ceilingReading(db(), "reports", now);
  return !reading.isOver;
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
 *
 * **Past the report breaker's ceiling it only queues** (design 164): a
 * person still looks, nothing is hidden, so no notice is owed. Holding a
 * hide's notice back instead would be the silent restriction below.
 */
async function hidePendingReview(
  subjectType: ReportSubjectType,
  subjectId: string,
  alerts: BatchItem<"sqlite">[],
  purge: PurgeTags,
  opening: {
    readonly canHide: boolean;
    readonly isAtOnce: boolean;
    /**
     * What the re-open, the hides and the author's notice still hold to
     * as the batch runs (`fileReport`'s bar); the reconcile's own read
     * needs none.
     */
    readonly heldTo?: SQL | undefined;
  },
): Promise<void> {
  const { canHide } = opening;
  const heldTo = opening.heldTo ?? sql`1`;
  const queueWrite = enqueueForReview(
    db(),
    {
      subjectType,
      subjectId,
      source: "reports",
      // What the reports breaker counts: an opening it let hide (design
      // 164), 1; one a reason that hides at once hid without asking it, 2;
      // one that only queued, 0.
      hid: hidAs(opening),
    },
    heldTo,
  );
  // Queued only, it still owes its alerts (design 232): a person must
  // still look within the 48 hours, and the alert is what says so.
  if (!canHide) {
    await db().batch([queueWrite, ...alerts]);
    return;
  }

  // Read before the batch, which cannot branch: whose it is, for the
  // author's notice that it was hidden (C8, D-145).
  const told = await hiddenNotice(db(), subjectType, subjectId, heldTo);

  // The operators' alerts ride in the same batch (design 136): a hide that
  // starts a 48-hour clock never lands without the email that says so. So
  // does the author's notice: a hide nobody was told of is the silent
  // restriction DSA Art. 17 forbids.
  await db().batch([
    queueWrite,
    ...hideWritesFor[subjectType](subjectId, heldTo),
    ...alerts,
    ...told,
  ]);
  // Design 163: a hidden kit leaves the edge now, not within the TTL, and
  // so does a hidden photo's kit, whose page shows it; the purge deletes
  // the photo's public copy too (step 8). A profile and a product hide
  // nothing there (a profile is a ban's to take down).
  purge(await subjectCacheTagsOf(db(), subjectType, subjectId));
}

/**
 * How an opening records its hide for the reports breaker: 1 where the
 * breaker let it hide, 2 where a reason that hides at once hid it without
 * asking, 0 where it only queued.
 */
function hidAs(opening: {
  readonly canHide: boolean;
  readonly isAtOnce: boolean;
}): 0 | 1 | 2 {
  if (!opening.canHide) return 0;
  return opening.isAtOnce ? 2 : 1;
}

/**
 * The subject's row, unless it is in the one state a report's hide must
 * not overwrite, while the report still holds to `heldTo`.
 */
function hideableWhere(
  columns: Readonly<{ id: SQLiteColumn; status: SQLiteColumn }>,
  hide: Readonly<{ subjectId: string; notOver: string; heldTo: SQL }>,
): SQL | undefined {
  return and(
    eq(columns.id, hide.subjectId),
    ne(columns.status, hide.notOver),
    hide.heldTo,
  );
}

/**
 * What crossing the threshold hides, per subject type.
 *
 * Keyed rather than written as `if (subjectType !== "entry")`, which was
 * a branch no test could tell from its opposite: running the entry update
 * against a product id matches no row, so both sides of it looked
 * identical from outside. A lookup has no branch to get wrong, and
 * `Record<ReportSubjectType, …>` makes a new subject type a compile error
 * here rather than a silent no-op.
 */
const hideWritesFor: Record<
  ReportSubjectType,
  (subjectId: string, heldTo: SQL) => BatchItem<"sqlite">[]
> = {
  // Never over `removed`, a copyright takedown's hide (D-130): it is
  // hidden already, and a review's Approve must not be what ends it.
  entry: (subjectId, heldTo) => [
    db()
      .update(outfitEntries)
      .set({ moderationStatus: "hidden_pending_review" })
      .where(
        hideableWhere(
          { id: outfitEntries.id, status: outfitEntries.moderationStatus },
          { subjectId, notOver: "removed", heldTo },
        ),
      ),
  ],
  // A photo hides the way the classifier hides one, and into the same
  // state for the same reason: `hidden_pending_review` is exactly "not
  // public, a person will look", which is what crossing the threshold
  // means. Entry photos only — a garment photo carries the same subject
  // type but lives in `wardrobe_items.visibility`, and a closet is
  // private, so nobody but its owner can see one to report it.
  photo: (subjectId, heldTo) => [
    db()
      .update(entryPhotos)
      .set({ screenStatus: "hidden_pending_review" })
      .where(
        hideableWhere(
          { id: entryPhotos.id, status: entryPhotos.screenStatus },
          { subjectId, notOver: heldPhotoStatus, heldTo },
        ),
      ),
  ],
  // The two that hide nothing, each for its own reason. A profile is a
  // ban decision, which is a person's call with its own path and its own
  // notice. A product's rows stay visible until a reviewer removes them,
  // because hiding a shared canonical row on three reports would take
  // every garment linked to it down with it.
  profile: () => [],
  product: () => [],
};

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
