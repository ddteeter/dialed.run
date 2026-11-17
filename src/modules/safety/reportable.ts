/**
 * What a report may name, and how many one runner may file (design 232,
 * SA-M10).
 *
 * A report names a subject the reporter can see: a kit or kit photo that
 * is theirs or shared with runners, or a profile or product that exists.
 * The read has no moderation clause and no reported-by clause on purpose:
 * a kit already hidden for one reason may still be reported for another
 * (an intimate image's 48 hours start at its own report), and a repeat of
 * the reporter's own report is answered by `fileReport`, not refused here.
 *
 * Read from whatever `coreDb()` is in scope: the report's server function
 * gates on `verifiedUserId`, which pins the primary.
 */
import { and, eq, inArray, or } from "drizzle-orm";
import type { SQL } from "drizzle-orm";
import type { drizzle } from "drizzle-orm/d1";

import {
  entryPhotos,
  outfitEntries,
  products,
  sharedAudience,
  userProfiles,
} from "../../db/schema-core";
import { hasRowWhere } from "../../lib/sql/keyed-read";
import { forgetRateLimit, isWithinRateLimit } from "../email";
import {
  AT_ONCE_HIDES_PER_DAY,
  REPORTS_PER_DAY,
  type ReportSubjectType,
} from "./contracts";

type Db = ReturnType<typeof drizzle>;

const DAY_S = 24 * 60 * 60;

/**
The kit is the reporter's own or shared with runners.
*/
function seenBy(reporterId: string): SQL | undefined {
  return or(
    eq(outfitEntries.userId, reporterId),
    sharedAudience(outfitEntries.audience),
  );
}

/**
The kit `kitIs` names is the reporter's own or shared with runners.
*/
function isSeenKit(db: Db, reporterId: string, kitIs: SQL): Promise<boolean> {
  return hasRowWhere(
    db,
    outfitEntries,
    outfitEntries.id,
    and(kitIs, seenBy(reporterId)),
  );
}

function isKitSeen(
  db: Db,
  reporterId: string,
  entryId: string,
): Promise<boolean> {
  return isSeenKit(db, reporterId, eq(outfitEntries.id, entryId));
}

/**
A kit photo is seen where its kit is: one read, the photo's kit.
*/
function isKitPhotoSeen(
  db: Db,
  reporterId: string,
  photoId: string,
): Promise<boolean> {
  const photosKit = db
    .select({ entryId: entryPhotos.entryId })
    .from(entryPhotos)
    .where(eq(entryPhotos.id, photoId));
  return isSeenKit(db, reporterId, inArray(outfitEntries.id, photosKit));
}

/**
 * Keyed by subject type, so a new type is a compile error here rather
 * than a subject nobody checks.
 */
const reportableReads: Record<
  ReportSubjectType,
  (db: Db, reporterId: string, subjectId: string) => Promise<boolean>
> = {
  entry: isKitSeen,
  photo: isKitPhotoSeen,
  // A profile a reporter can see has a handle, so a profile row.
  profile: (db, _reporterId, subjectId) =>
    hasRowWhere(
      db,
      userProfiles,
      userProfiles.userId,
      eq(userProfiles.userId, subjectId),
    ),
  product: (db, _reporterId, subjectId) =>
    hasRowWhere(db, products, products.id, eq(products.id, subjectId)),
};

/**
 * Why a report may not be filed, or `undefined` when it may: `not_found`
 * for a subject that does not exist or that the reporter cannot see,
 * `limited` past today's reports. Counts the report only once the subject
 * is found, so an invented id is not counted against anyone.
 */
export async function reportRefusalOf(
  db: Db,
  report: Readonly<{
    reporterId: string;
    subjectType: ReportSubjectType;
    subjectId: string;
  }>,
  now: number,
): Promise<"not_found" | "limited" | undefined> {
  const isSeen = await reportableReads[report.subjectType](
    db,
    report.reporterId,
    report.subjectId,
  );
  if (!isSeen) return "not_found";
  const isWithin = await isWithinReportLimit(db, report.reporterId, now);
  return isWithin ? undefined : "limited";
}

/**
Count one report, and say whether the reporter is within today's.
*/
export async function isWithinReportLimit(
  db: Db,
  reporterId: string,
  now: number,
): Promise<boolean> {
  return isWithinRateLimit(
    db,
    "report-runner",
    reporterId,
    REPORTS_PER_DAY,
    DAY_S,
    now,
  );
}

/**
Count one hide at once, and say whether the reporter is within today's.
*/
export async function isWithinAtOnceLimit(
  db: Db,
  reporterId: string,
  now: number,
): Promise<boolean> {
  return isWithinRateLimit(
    db,
    "report-at-once",
    reporterId,
    AT_ONCE_HIDES_PER_DAY,
    DAY_S,
    now,
  );
}

/**
 * Forget a runner's report counts, for the purge's batch: a deleted
 * runner's id is not kept as the subject of a count.
 */
export function forgetReportCounts(db: Db, reporterId: string) {
  return [
    forgetRateLimit(db, "report-runner", reporterId),
    forgetRateLimit(db, "report-at-once", reporterId),
  ] as const;
}
