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
import { and, asc, desc, eq, ne, sql } from "drizzle-orm";
import type { drizzle } from "drizzle-orm/d1";
import { alias } from "drizzle-orm/sqlite-core";

import {
  entryPhotos,
  moderationActions,
  outfitEntries,
} from "../../db/schema-core";
import { publiclyVisibleEntry } from "./visibility";

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
 * Review takes; its kit; and its key, which `/safety/review-photo/` serves
 * to an operator.
 */
export interface OtherPhoto {
  readonly id: string;
  readonly entryId: string;
  readonly photoKey: string;
  /**
   * Whether the kit's page opens for an operator (review S4). The page is
   * `/feed/entry/$entryId`, which an operator reaches the same way a runner
   * does, so a private kit or one hidden pending review sends them away. Read
   * from safety's one visibility rule, without a viewer: an operator the
   * runner blocked is the one case it misses, and that link bounces.
   */
  readonly canOpen: boolean;
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
      canOpen: sql<boolean>`${publiclyVisibleEntry()}`.mapWith(Boolean),
    })
    .from(outfitEntries)
    .innerJoin(entryPhotos, eq(entryPhotos.entryId, outfitEntries.id))
    .where(othersWhere(db, subject))
    .orderBy(desc(outfitEntries.createdAt), asc(entryPhotos.position))
    .limit(OTHER_PHOTOS_LIMIT);
}

/**
 * The runner's photos, less the subject's own and any on a removed kit.
 *
 * **Private kits are listed too, on purpose** (owner, 2026-10-12, on
 * PR #188's review): there is no `audience` filter here. A copy of an
 * intimate image is no less a copy for being posted privately, and the
 * operator checking copies has to see it. The privacy policy is amended
 * to say operators may see private photos for this check (PR #182);
 * `test/safety/other-photos.test.ts` pins the inclusion.
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
 * Whose the subject is, as a subquery: the live row's runner, or — once
 * the subject is gone — the runner the Desk's audit row recorded.
 *
 * **A subject can be deleted while its request waits.** A runner can
 * delete their own kit, or a Remove from the queue can take it down
 * before the request is decided, and the live read then finds nobody: the
 * row would say "No other photos from this runner." about a runner who
 * has some, which is the one thing a copy check must not say falsely. The
 * audit row (`moderation_actions.subject_owner_id`, read by
 * `moderation_actions_subject`) outlives the delete. A runner's own
 * delete leaves no audit row, so that case still finds nobody.
 */
function runnerOf(db: Db, subject: OtherPhotosSubject) {
  return sql`coalesce((${liveRunnerOf(db, subject)}), (${recordedRunnerOf(db, subject)}))`;
}

/**
The runner of the subject as it stands: a photo's kit's, or the kit's. Each a primary-key probe.
*/
function liveRunnerOf(db: Db, subject: OtherPhotosSubject) {
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
 * The runner the Desk recorded for the subject, from any audit row about
 * it. Every row about an entry or a photo names its owner
 * (`moderateContent` always has one), so any of them answers.
 */
function recordedRunnerOf(db: Db, subject: OtherPhotosSubject) {
  return db
    .select({ userId: moderationActions.subjectOwnerId })
    .from(moderationActions)
    .where(
      and(
        eq(moderationActions.subjectType, subject.subjectType),
        eq(moderationActions.subjectId, subject.subjectId),
      ),
    )
    .limit(1);
}

/**
 * What the row already shows, so it is not listed again: the one photo,
 * or every photo on the kit.
 */
const LEFT_OUT = {
  photo: (subjectId: string) => ne(entryPhotos.id, subjectId),
  entry: (subjectId: string) => ne(entryPhotos.entryId, subjectId),
} as const;
