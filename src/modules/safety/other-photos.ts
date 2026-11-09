/**
 * The same runner's other photos, for a Review row about an intimate
 * image (design 136, decision D-117; R-145 c).
 *
 * The TAKE IT DOWN Act asks for reasonable efforts on known identical
 * copies. This is the person's half: the row shows what else this runner
 * has posted, and the operator looks. The hashed half, every runner's
 * photos by fingerprint, is `photo-matches.ts` (D-142).
 *
 * **One select per subject, all in one batch, every filter in SQL.** The
 * runner is a subquery on the subject (a photo's kit, or the kit), so no
 * read decides what the next one asks. The subject itself is left out —
 * the row already shows it, or links its kit — and so is a kit already
 * removed. Served by an index on `outfit_entries.user_id` for the runner's
 * kits (`entries_user_created`, or `entries_user_shared_created` since
 * the window count reads them all), and by `entry_photos_idempotency`'s `entry_id` prefix for each
 * kit's photos: no scan of either table, which
 * `test/safety/other-photos.test.ts` pins with EXPLAIN. The total and the
 * runner's handle (round 38 #63a) ride on the same rows: a window count
 * taken before the limit, and a primary-key probe of `user_profiles`.
 */
import { and, asc, eq, lte, ne, not, sql, type SQL } from "drizzle-orm";
import type { drizzle } from "drizzle-orm/d1";
import { alias } from "drizzle-orm/sqlite-core";

import {
  entryPhotos,
  moderationActions,
  outfitEntries,
  userProfiles,
} from "../../db/schema-core";
import { jsonField, jsonTable } from "../../lib/sql/json-list";

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
 * Review takes; its kit; and its key, which `/desk/review-photo/` serves
 * to an operator.
 */
export interface OtherPhoto {
  readonly id: string;
  readonly entryId: string;
  readonly photoKey: string;
}

/**
 * What a row shows of the runner's other photos (round 38 #63a): the
 * newest `OTHER_PHOTOS_LIMIT`, how many there are in all, which the
 * kicker counts, and the runner's handle, for "+ N more · Open @name in
 * Runners" past the limit; absent for a runner with no handle.
 */
export interface OtherPhotos {
  readonly photos: readonly OtherPhoto[];
  readonly total: number;
  readonly handle: string | undefined;
}

/**
One row of the read: a photo, and what every row repeats.
*/
type OtherPhotoRow = OtherPhoto &
  Readonly<{ key: string; total: number; handle: string | null }>;

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
The subject photo, likewise apart from the outer read's `entry_photos`.
*/
const subjectPhoto = alias(entryPhotos, "subject_photo");

/**
 * Each subject's other photos, by `subjectType:subjectId`. A subject
 * whose kit is gone, or whose runner has posted nothing else, maps to an
 * empty list.
 *
 * **One statement for the page** (design 188, #490): the subjects are one
 * bound JSON list, each a row the read joins, and each subject's limit
 * and total are window functions partitioned by it.
 */
export async function otherPhotosOf(
  db: Db,
  subjects: readonly OtherPhotosSubject[],
): Promise<Map<string, OtherPhotos | undefined>> {
  if (subjects.length === 0) return new Map();
  const rows = await otherPhotosQuery(db, subjects);
  return new Map(
    subjects.map((subject) => {
      const key = keyOf(subject);
      return [key, shown(rows.filter((row) => row.key === key))];
    }),
  );
}

function keyOf(subject: OtherPhotosSubject): string {
  return `${subject.subjectType}:${subject.subjectId}`;
}

/**
 * A subject's rows as the row shows them. Every row carries the total and
 * the handle, so none means none in all.
 */
function shown(rows: readonly OtherPhotoRow[]): OtherPhotos {
  const [first] = rows;
  return {
    photos: rows.map(({ id, entryId, photoKey }) => ({
      id,
      entryId,
      photoKey,
    })),
    total: first?.total ?? 0,
    handle: first?.handle ?? undefined,
  };
}

/**
 * The columns a bound list of subjects is read back as (`jsonTable`): the
 * subject's key, its type and its id. Both Desk reads that take a page of
 * subjects in one statement name them the same way, prefixed with the
 * table's own name, which keeps them apart from every column the read
 * touches.
 */
export function subjectColumns(prefix: string) {
  return {
    key: jsonField<string>("key").as(`${prefix}_key`),
    subjectType: jsonField<string>("subjectType").as(`${prefix}_type`),
    subjectId: jsonField<string>("subjectId").as(`${prefix}_id`),
  };
}

/**
 * The subjects as a table the read joins: one row each, the list bound as
 * one parameter.
 */
function subjectTable(db: Db, subjects: readonly OtherPhotosSubject[]) {
  const keyed = subjects.map((subject) => ({
    ...subject,
    key: keyOf(subject),
  }));
  // `about`, not `subject`: `moderation_actions` has a `subject_type` and
  // a `subject_id` of its own (`jsonTable`). The table's name prefixes its
  // columns', so one name keeps both apart.
  const name = "about";
  return jsonTable(db, name, keyed, subjectColumns(name));
}

type Subject = ReturnType<typeof subjectTable>;

/**
 * The page's read — exported so its plan can be asked of SQLite. The
 * subjects are the outer loop (`CROSS JOIN` keeps SQLite from turning
 * it), so each one's runner is a constant its kits are probed by.
 */
export function otherPhotosQuery(
  db: Db,
  subjects: readonly OtherPhotosSubject[],
) {
  const subject = subjectTable(db, subjects);
  const runner = runnerOf(db, subject);
  const ranked = db.$with("ranked").as(
    db
      .select({
        key: subject.key,
        id: entryPhotos.id,
        entryId: entryPhotos.entryId,
        photoKey: entryPhotos.photoKey,
        // Counted over every row the filter keeps for the subject, before
        // the limit: the total the kicker says (round 38 #63a).
        total: sql<number>`count(*) over (partition by ${subject.key})`.as(
          "ranked_total",
        ),
        // The runner's handle, by primary key, for the link to D8.
        handle: sql<
          string | null
        >`(SELECT ${userProfiles.username} FROM ${userProfiles} WHERE ${userProfiles.userId} = ${runner})`.as(
          "ranked_handle",
        ),
        place:
          sql<number>`row_number() over (partition by ${subject.key} order by ${outfitEntries.createdAt} desc, ${entryPhotos.position} asc)`.as(
            "ranked_place",
          ),
      })
      .from(subject)
      .crossJoin(outfitEntries)
      .innerJoin(entryPhotos, eq(entryPhotos.entryId, outfitEntries.id))
      .where(othersWhere(subject, runner)),
  );
  return db
    .with(subject, ranked)
    .select({
      key: ranked.key,
      id: ranked.id,
      entryId: ranked.entryId,
      photoKey: ranked.photoKey,
      total: sql<number>`${ranked.total}`.mapWith(Number),
      handle: ranked.handle,
    })
    .from(ranked)
    .where(lte(ranked.place, OTHER_PHOTOS_LIMIT))
    .orderBy(asc(ranked.key), asc(ranked.place));
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
function othersWhere(subject: Subject, runner: SQL) {
  return and(
    eq(outfitEntries.userId, runner),
    ne(outfitEntries.moderationStatus, "removed"),
    not(leftOut(subject)),
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
function runnerOf(db: Db, subject: Subject): SQL {
  return sql`coalesce((${liveRunnerOf(db, subject)}), (${recordedRunnerOf(db, subject)}))`;
}

/**
 * The runner of the subject as it stands: a photo's kit's, or the kit's.
 * Each a primary-key probe; the arm for the other type finds nothing.
 */
function liveRunnerOf(db: Db, subject: Subject) {
  const ofPhoto = db
    .select({ userId: subjectEntry.userId })
    .from(subjectPhoto)
    .innerJoin(subjectEntry, eq(subjectEntry.id, subjectPhoto.entryId))
    .where(
      and(
        sql`${subject.subjectType} = 'photo'`,
        eq(subjectPhoto.id, sql`${subject.subjectId}`),
      ),
    );
  const ofEntry = db
    .select({ userId: subjectEntry.userId })
    .from(subjectEntry)
    .where(
      and(
        sql`${subject.subjectType} = 'entry'`,
        eq(subjectEntry.id, sql`${subject.subjectId}`),
      ),
    );
  return sql`coalesce((${ofPhoto}), (${ofEntry}))`;
}

/**
 * The runner the Desk recorded for the subject, from any audit row about
 * it. Every row about an entry or a photo names its owner
 * (`moderateContent` always has one), so any of them answers.
 */
function recordedRunnerOf(db: Db, subject: Subject) {
  return db
    .select({ userId: moderationActions.subjectOwnerId })
    .from(moderationActions)
    .where(
      and(
        eq(moderationActions.subjectType, sql`${subject.subjectType}`),
        eq(moderationActions.subjectId, sql`${subject.subjectId}`),
      ),
    )
    .limit(1);
}

/**
 * What the row already shows, so it is not listed again: the one photo,
 * or every photo on the kit. Parenthesised whole, since `not()` spells
 * `not <condition>`, which binds tighter than the `or` inside it.
 */
function leftOut(subject: Subject): SQL {
  return sql`((${subject.subjectType} = 'photo' and ${entryPhotos.id} = ${subject.subjectId}) or (${subject.subjectType} = 'entry' and ${entryPhotos.entryId} = ${subject.subjectId}))`;
}
