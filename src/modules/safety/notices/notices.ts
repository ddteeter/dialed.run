/**
 * The notices a report's life owes (C8; D-132, D-145): the author's when a
 * report hides their kit or photo and when a person leaves it up, and the
 * reporter's when a person decides. An automatic hold owes its author the
 * same two (D-162). Each is a bell row, the path a
 * removal's notice already takes, built here as statements for the batch
 * of the change it reports. A read that decides who is told runs first,
 * because a batch cannot branch on its own results.
 *
 * **Suspected CSAM is silent** (D-70): a quarantine owes none of these,
 * which its callers decide by never asking for one.
 */
import { and, eq, ne, sql, type SQL } from "drizzle-orm";
import type { BatchItem } from "drizzle-orm/batch";
import type { drizzle } from "drizzle-orm/d1";

import {
  entryPhotos,
  outfitEntries,
  reports,
  reviewQueue,
} from "../../../db/schema-core";
import { columnWhere } from "../../../lib/sql/keyed-read";
import { qualified } from "../../../lib/sql/qualified";
import {
  notificationInsert,
  notificationInsertWhere,
  notificationRaise,
  notificationRaiseWhere,
} from "../../notifications";

import type { ReportSubjectType } from "../rules";
import {
  HIDDEN_NOTICE,
  KEPT_NOTICE,
  REPORT_OUTCOME,
  SCREENING_HIDDEN_NOTICE,
  SCREENING_KEPT_NOTICE,
  type Authored,
  type ReportOutcome,
} from "./notice-copy";
import { heldPhotoStatus } from "../rules";

type Db = ReturnType<typeof drizzle<Record<string, never>>>;

/**
Each outcome's notification kind.
*/
const OUTCOME_KIND = {
  removed: "report_removed",
  kept: "report_kept",
} as const;

function isAuthored(subjectType: ReportSubjectType): subjectType is Authored {
  return subjectType === "entry" || subjectType === "photo";
}

/**
 * Whose the thing is — unless a copyright takedown has hidden it (D-130),
 * which a report's hide and an Approve both leave alone, so telling its
 * author either would be false. Primary-key probes.
 */
const authorOf: Record<
  Authored,
  (db: Db, subjectId: string) => Promise<{ userId: string }[]>
> = {
  entry: (db, subjectId) =>
    db
      .select({ userId: outfitEntries.userId })
      .from(outfitEntries)
      .where(
        and(
          eq(outfitEntries.id, subjectId),
          ne(outfitEntries.moderationStatus, "removed"),
        ),
      ),
  photo: (db, subjectId) =>
    photoAuthorWhere(
      db,
      subjectId,
      ne(entryPhotos.screenStatus, heldPhotoStatus),
    ),
};

/**
 * One author notice, raised rather than inserted: a kit can be hidden,
 * left up and hidden again, and each time is owed a notice.
 */
async function authorNotice(
  db: Db,
  kind: "content_hidden" | "content_kept",
  words: Readonly<Record<Authored, string>>,
  subjectType: ReportSubjectType,
  subjectId: string,
  onlyIf: SQL,
): Promise<BatchItem<"sqlite">[]> {
  if (!isAuthored(subjectType)) return [];
  const authors = await authorOf[subjectType](db, subjectId);
  return authors.map(({ userId }) =>
    notificationRaiseWhere(
      db,
      { userId, kind, subjectId, body: words[subjectType] },
      onlyIf,
    ),
  );
}

/**
A notice's condition when its batch has none: always.
*/
const ALWAYS = sql`1`;

/**
 * The author's notice that a report hid their kit or photo (D-145).
 * Nothing for a profile or a product, which a report never hides.
 * `onlyIf` is the batch's condition for the hide, when it has one.
 */
export function hiddenNotice(
  db: Db,
  subjectType: ReportSubjectType,
  subjectId: string,
  onlyIf: SQL = ALWAYS,
): Promise<BatchItem<"sqlite">[]> {
  return authorNotice(
    db,
    "content_hidden",
    HIDDEN_NOTICE,
    subjectType,
    subjectId,
    onlyIf,
  );
}

/**
 * The hide notice to a named author, raised only where `onlyIf` holds in
 * its batch: for a writer that knows the author from its own row and
 * cannot read them from the subject, as a copyright restore that hands
 * a kit to review cannot while the kit still reads as removed.
 */
export function hiddenNoticeTo(
  db: Db,
  author: { readonly userId: string },
  subject: { readonly subjectType: Authored; readonly subjectId: string },
  onlyIf: SQL,
): BatchItem<"sqlite"> {
  return notificationRaiseWhere(
    db,
    {
      userId: author.userId,
      kind: "content_hidden",
      subjectId: subject.subjectId,
      body: HIDDEN_NOTICE[subject.subjectType],
    },
    onlyIf,
  );
}

/**
 * The notices an automatic hold of a kit photo owes its author (D-162):
 * the hide, while the photo is still `pending` (one a report already hid
 * was told then), and the "left it up" on an Approve, while it is still
 * held (a classifier `review`-band row hid nothing and told nobody).
 */
const SCREENING_NOTICES = {
  hidden: {
    kind: "content_hidden",
    status: "pending",
    body: SCREENING_HIDDEN_NOTICE,
  },
  kept: {
    kind: "content_kept",
    status: "hidden_pending_review",
    body: SCREENING_KEPT_NOTICE,
  },
} as const;

/**
 * The hide notice when the uploader is known and the photo row goes in
 * the same batch: a fingerprint hold at upload. Raised, as a report's
 * hide is.
 */
export function screeningHoldNotice(
  db: Db,
  userId: string,
  photoId: string,
): BatchItem<"sqlite"> {
  const { kind, body } = SCREENING_NOTICES.hidden;
  return notificationRaise(db, { userId, kind, subjectId: photoId, body });
}

/**
 * One of the hold's notices, its author read first (`SCREENING_NOTICES`
 * says while which state): a classifier flag's hide, or an Approve's
 * "left it up". Nothing for a photo gone since, or past that state.
 */
export async function screeningNotice(
  db: Db,
  photoId: string,
  which: keyof typeof SCREENING_NOTICES,
  onlyIf: SQL = ALWAYS,
): Promise<BatchItem<"sqlite">[]> {
  const { kind, status, body } = SCREENING_NOTICES[which];
  const authors = await photoAuthorWhere(
    db,
    photoId,
    eq(entryPhotos.screenStatus, status),
  );
  return authors.map(({ userId }) =>
    notificationRaiseWhere(
      db,
      { userId, kind, subjectId: photoId, body },
      onlyIf,
    ),
  );
}

/**
 * A kit photo's author, while `status` holds of the photo. A
 * primary-key probe.
 */
function photoAuthorWhere(
  db: Db,
  photoId: string,
  status: SQL,
): Promise<{ userId: string }[]> {
  return db
    .select({ userId: outfitEntries.userId })
    .from(entryPhotos)
    .innerJoin(outfitEntries, eq(outfitEntries.id, entryPhotos.entryId))
    .where(and(eq(entryPhotos.id, photoId), status));
}

/**
The author's notice that a person left their reported kit or photo up.
*/
export function keptNotice(
  db: Db,
  subjectType: ReportSubjectType,
  subjectId: string,
  onlyIf: SQL,
): Promise<BatchItem<"sqlite">[]> {
  return authorNotice(
    db,
    "content_kept",
    KEPT_NOTICE,
    subjectType,
    subjectId,
    onlyIf,
  );
}

/**
 * Everyone who reported this subject. The UNIQUE index keeps one report
 * per reporter, so these are people, not clicks.
 */
export function reporterIdsOf(
  db: Db,
  subjectType: ReportSubjectType,
  subjectId: string,
): Promise<string[]> {
  return columnWhere(
    db,
    reports,
    reports.reporterId,
    and(eq(reports.subjectType, subjectType), eq(reports.subjectId, subjectId)),
  );
}

/**
 * Each reporter's notice of the outcome (D-132, DSA Art. 16(5)). Inserted
 * once per reporter, outcome and subject: a retried decision tells nobody
 * twice. Given the Review row an Approve settles (`approvedIn`), only a
 * reporter whose report was filed by the Approve that row records, as the
 * batch has just written it, is told: the notices and the count read one
 * moment.
 */
export async function reporterNotices(
  db: Db,
  subjectType: ReportSubjectType,
  subjectId: string,
  outcome: ReportOutcome,
  onlyIf: SQL = ALWAYS,
  approvedIn?: string,
): Promise<BatchItem<"sqlite">[]> {
  const reporters = await reporterIdsOf(db, subjectType, subjectId);
  const approvedAt = sql`(select ${qualified(reviewQueue, reviewQueue.approvedAt)} from ${reviewQueue} where ${qualified(reviewQueue, reviewQueue.id)} = ${approvedIn})`;
  const filedInTime = (userId: string) =>
    approvedIn === undefined
      ? onlyIf
      : sql`${onlyIf} and exists (select 1 from ${reports} where ${and(eq(reports.reporterId, userId), eq(reports.subjectType, subjectType), eq(reports.subjectId, subjectId))} and ${reports.createdAt} <= ${approvedAt})`;
  return reporters.map((userId) =>
    notificationInsertWhere(
      db,
      {
        userId,
        kind: OUTCOME_KIND[outcome],
        subjectId,
        body: REPORT_OUTCOME[outcome],
      },
      filedInTime(userId),
    ),
  );
}

/**
 * The reporters of the photos on a kit the Desk removed (R-162 b; owner,
 * 2026-10-24): what they reported went with the kit, so each is told
 * "We removed what you reported." of the photo they reported. Read before
 * the batch deletes the photos: the kit's photos (`entry_photos_idempotency`
 * prefix), each joined to its reports (`reports_subject`). Once per
 * reporter and photo, as above.
 */
export async function photoReporterNotices(
  db: Db,
  entryId: string,
): Promise<BatchItem<"sqlite">[]> {
  const reported = await db
    .select({ userId: reports.reporterId, subjectId: reports.subjectId })
    .from(reports)
    .innerJoin(
      entryPhotos,
      and(
        eq(reports.subjectType, "photo"),
        eq(reports.subjectId, entryPhotos.id),
      ),
    )
    .where(eq(entryPhotos.entryId, entryId));
  return reported.map(({ userId, subjectId }) =>
    notificationInsert(db, {
      userId,
      kind: OUTCOME_KIND.removed,
      subjectId,
      body: REPORT_OUTCOME.removed,
    }),
  );
}
