/**
 * The same runner's other photos, for a Review row about an intimate
 * image (design 136, decision D-117; R-145 c).
 *
 * The TAKE IT DOWN Act asks for reasonable efforts on known identical
 * copies. Nothing here hashes photos — blur re-encodes every upload, so
 * an exact hash would rarely match — so the effort is a person's: the row
 * shows what else this runner has posted, and the operator looks.
 *
 * **One select per subject, all in one batch, every filter in SQL.** The
 * runner is a subquery on the subject (a photo's kit, or the kit), so no
 * read decides what the next one asks. The subject itself is left out —
 * the row already shows it, or links its kit — and so is a kit already
 * removed. Served by `entries_user_created` for the runner's kits, newest
 * first, and by `entry_photos_idempotency`'s `entry_id` prefix for each
 * kit's photos: no scan of either table, which
 * `test/safety/other-photos.test.ts` pins with EXPLAIN.
 */
import { and, asc, desc, eq, ne } from "drizzle-orm";
import type { drizzle } from "drizzle-orm/d1";
import { alias } from "drizzle-orm/sqlite-core";

import { entryPhotos, outfitEntries } from "../../db/schema-core";

type Db = ReturnType<typeof drizzle>;

/**
 * How many other photos a row lists. A bound rather than a courtesy: the
 * page reads one batch for every row it shows, and a runner with hundreds
 * of photos is a page nobody scrolls. The newest come first, because a
 * copy is most likely posted near the original.
 */
export const OTHER_PHOTOS_LIMIT = 12;

/**
 * One of the runner's other photos: its id, which the takedown form under
 * Review takes; its kit, which Review opens; and its key, which
 * `/safety/review-photo/` serves to an operator.
 */
export interface OtherPhoto {
  readonly id: string;
  readonly entryId: string;
  readonly photoKey: string;
}

export interface OtherPhotosSubject {
  readonly subjectType: "entry" | "photo";
  readonly subjectId: string;
}

/**
 * The kit a subject photo sits on, under its own name so the outer read's
 * `outfit_entries` is not shadowed.
 */
const subjectEntry = alias(outfitEntries, "subject_entry");

/**
 * Each subject's other photos, by `subjectType:subjectId`. A subject
 * whose kit is gone, or whose runner has posted nothing else, maps to an
 * empty list.
 */
export async function otherPhotosOf(
  db: Db,
  subjects: readonly OtherPhotosSubject[],
): Promise<Map<string, readonly OtherPhoto[] | undefined>> {
  const [first, ...rest] = subjects.map((subject) =>
    otherPhotosQuery(db, subject),
  );
  if (first === undefined) return new Map();
  const found = await db.batch([first, ...rest]);
  return new Map(
    subjects.map((subject, index) => [
      `${subject.subjectType}:${subject.subjectId}`,
      // The batch answers each query in order, so every index is there;
      // the type says `undefined` because an index read always may.
      found[index],
    ]),
  );
}

/**
 * One subject's read, un-awaited for the batch — exported so its plan can
 * be asked of SQLite.
 */
export function otherPhotosQuery(db: Db, subject: OtherPhotosSubject) {
  return db
    .select({
      id: entryPhotos.id,
      entryId: entryPhotos.entryId,
      photoKey: entryPhotos.photoKey,
    })
    .from(outfitEntries)
    .innerJoin(entryPhotos, eq(entryPhotos.entryId, outfitEntries.id))
    .where(othersWhere(db, subject))
    .orderBy(desc(outfitEntries.createdAt), asc(entryPhotos.position))
    .limit(OTHER_PHOTOS_LIMIT);
}

/**
 * The runner's photos, less the subject's own and any on a removed kit.
 */
function othersWhere(db: Db, subject: OtherPhotosSubject) {
  const runnersOwn = eq(outfitEntries.userId, runnerOf(db, subject));
  return and(
    runnersOwn,
    ne(outfitEntries.moderationStatus, "removed"),
    LEFT_OUT[subject.subjectType](subject.subjectId),
  );
}

/**
 * Whose the subject is, as a subquery: a photo's kit's runner, or the
 * kit's. Each is a primary-key probe.
 */
function runnerOf(db: Db, subject: OtherPhotosSubject) {
  return subject.subjectType === "photo"
    ? db
        .select({ userId: subjectEntry.userId })
        .from(entryPhotos)
        .innerJoin(subjectEntry, eq(subjectEntry.id, entryPhotos.entryId))
        .where(eq(entryPhotos.id, subject.subjectId))
    : db
        .select({ userId: subjectEntry.userId })
        .from(subjectEntry)
        .where(eq(subjectEntry.id, subject.subjectId));
}

/**
 * What the row already shows, so it is not listed again: the one photo,
 * or every photo on the kit.
 */
const LEFT_OUT = {
  photo: (subjectId: string) => ne(entryPhotos.id, subjectId),
  entry: (subjectId: string) => ne(entryPhotos.entryId, subjectId),
} as const;
