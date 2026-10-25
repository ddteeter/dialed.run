/**
 * The notices a report's life owes (C8; D-132, D-145): the author's when a
 * report hides their kit or photo and when a person leaves it up, and the
 * reporter's when a person decides. Each is a bell row, the path a
 * removal's notice already takes, built here as statements for the batch
 * of the change it reports. A read that decides who is told runs first,
 * because a batch cannot branch on its own results.
 *
 * **Suspected CSAM is silent** (D-70): a quarantine owes none of these,
 * which its callers decide by never asking for one.
 */
import { and, eq, inArray, ne } from "drizzle-orm";
import type { BatchItem } from "drizzle-orm/batch";
import type { drizzle } from "drizzle-orm/d1";

import { entryPhotos, outfitEntries, reports } from "../../db/schema-core";
import { columnWhere } from "../../lib/sql/keyed-read";
import { notificationInsert, notificationRaise } from "../notifications";

import type { ReportSubjectType } from "./contracts";
import {
  HIDDEN_NOTICE,
  KEPT_NOTICE,
  REPORT_OUTCOME,
  type Authored,
  type ReportOutcome,
} from "./notice-copy";
import { heldPhotoStatus } from "./visibility";

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
    db
      .select({ userId: outfitEntries.userId })
      .from(entryPhotos)
      .innerJoin(outfitEntries, eq(outfitEntries.id, entryPhotos.entryId))
      .where(
        and(
          eq(entryPhotos.id, subjectId),
          ne(entryPhotos.screenStatus, heldPhotoStatus),
        ),
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
): Promise<BatchItem<"sqlite">[]> {
  if (!isAuthored(subjectType)) return [];
  const authors = await authorOf[subjectType](db, subjectId);
  return authors.map(({ userId }) =>
    notificationRaise(db, {
      userId,
      kind,
      subjectId,
      body: words[subjectType],
    }),
  );
}

/**
 * The author's notice that a report hid their kit or photo (D-145).
 * Nothing for a profile or a product, which a report never hides.
 */
export function hiddenNotice(
  db: Db,
  subjectType: ReportSubjectType,
  subjectId: string,
): Promise<BatchItem<"sqlite">[]> {
  return authorNotice(
    db,
    "content_hidden",
    HIDDEN_NOTICE,
    subjectType,
    subjectId,
  );
}

/**
The author's notice that a person left their reported kit or photo up.
*/
export function keptNotice(
  db: Db,
  subjectType: ReportSubjectType,
  subjectId: string,
): Promise<BatchItem<"sqlite">[]> {
  return authorNotice(db, "content_kept", KEPT_NOTICE, subjectType, subjectId);
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
 * twice.
 */
export async function reporterNotices(
  db: Db,
  subjectType: ReportSubjectType,
  subjectId: string,
  outcome: ReportOutcome,
): Promise<BatchItem<"sqlite">[]> {
  const reporters = await reporterIdsOf(db, subjectType, subjectId);
  return reporters.map((userId) =>
    notificationInsert(db, {
      userId,
      kind: OUTCOME_KIND[outcome],
      subjectId,
      body: REPORT_OUTCOME[outcome],
    }),
  );
}

/**
 * The reporters of the photos on a kit the Desk removed (R-162 b; owner,
 * 2026-10-24): what they reported went with the kit, so each is told
 * "We removed what you reported." of the photo they reported. One read
 * on `reports_subject`, and once per reporter and photo, as above.
 */
export async function photoReporterNotices(
  db: Db,
  photoIds: readonly string[],
): Promise<BatchItem<"sqlite">[]> {
  // A kit with no photos asks for none: drizzle's `inArray` of nothing is
  // `false`, so the read matches nothing rather than failing.
  const reported = await db
    .select({ userId: reports.reporterId, subjectId: reports.subjectId })
    .from(reports)
    .where(
      and(
        eq(reports.subjectType, "photo"),
        inArray(reports.subjectId, [...photoIds]),
      ),
    );
  return reported.map(({ userId, subjectId }) =>
    notificationInsert(db, {
      userId,
      kind: OUTCOME_KIND.removed,
      subjectId,
      body: REPORT_OUTCOME.removed,
    }),
  );
}
