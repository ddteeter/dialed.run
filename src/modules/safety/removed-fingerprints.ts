/**
 * The fingerprints of photos removed as intimate images shared without
 * consent, kept after the photo (D-147, design 152), and what reads them:
 * a kit or garment photo upload (design 157), which holds a copy for
 * review, and the Review row that copy lands on.
 *
 * **Only `intimate` removals keep one.** A quarantine keeps its own
 * snapshot for its own year (D-70), and known CSAM is PhotoDNA's to match
 * (D-129). A copyright hold keeps the photo itself, fingerprint included,
 * until its purge.
 *
 * **The check reads every kept row**, because no index seeks on a
 * distance (design 146). The table holds removed images only, so it stays
 * small while the photo tables grow.
 */
import {
  and,
  asc,
  between,
  eq,
  inArray,
  isNotNull,
  lte,
  sql,
  type SQL,
} from "drizzle-orm";
import type { drizzle } from "drizzle-orm/d1";
import type { SQLiteColumn } from "drizzle-orm/sqlite-core";

import {
  entryPhotos,
  moderationActions,
  removedFingerprints,
  userProfiles,
  wardrobeItems,
} from "../../db/schema-core";
import { newUlid } from "../../lib/ids";
import { nowSeconds } from "../../lib/now";
import {
  DISTINCTIVE_BITS,
  FINGERPRINT_MATCH_DISTANCE,
  fingerprintSchema,
  isDistinctive,
} from "../../lib/photo-fingerprint";
import { bitsSetSql, nearestOf } from "../../lib/sql/fingerprint-distance";
import { ceilingReading } from "./breakers";
import type { RemovalReason } from "./contracts";

type Db = ReturnType<typeof drizzle>;

/**
 * Keeps the fingerprints of the photos `photosInScope` selects, as
 * statements for the Remove's batch, ahead of the delete that takes the
 * photos: in one batch they are read before they go. A photo with no
 * fingerprint keeps nothing, and any reason but `intimate` keeps nothing
 * at all. Nor does one too plain to tell from other pictures (design 164),
 * which would hold every upload near it.
 */
export function keptFingerprints(
  db: Db,
  reason: RemovalReason,
  photosInScope: SQL,
  moderationActionId: string,
) {
  if (reason !== "intimate") return [];
  // Each field is named for the column it fills, read from the table.
  const into = removedFingerprints;
  const kept = db
    .select({
      // Minted in SQL, one per photo: an `INSERT … SELECT` has nowhere to
      // mint one in code per row, and nothing sorts these ids.
      id: sql<string>`lower(hex(randomblob(16)))`.as(into.id.name),
      fingerprint: filling<string>(into.fingerprint, entryPhotos.fingerprint),
      photoId: filling<string>(into.photoId, entryPhotos.id),
      moderationActionId: filling<string>(
        into.moderationActionId,
        moderationActionId,
      ),
      createdAt: filling<number>(into.createdAt, nowSeconds()),
    })
    .from(entryPhotos)
    .where(
      and(
        photosInScope,
        isNotNull(entryPhotos.fingerprint),
        distinctive(entryPhotos.fingerprint),
      ),
    );
  return [db.insert(removedFingerprints).select(kept)];
}

/**
A stored fingerprint inside `DISTINCTIVE_BITS`, as SQL (design 164).
*/
function distinctive(column: SQLiteColumn): SQL {
  const bits = bitsSetSql(column);
  return between(bits, DISTINCTIVE_BITS.fewest, DISTINCTIVE_BITS.most);
}

/**
A value selected under the name of the column it fills.
*/
function filling<T>(column: Readonly<{ name: string }>, value: unknown) {
  return sql<T>`${value}`.as(column.name);
}

/**
 * A garment's photo's fingerprint, kept when a person removes it as an
 * intimate image (R-167, design 159), as a kit photo's is, under the
 * garment's id. The garment was read before the batch, so its one
 * fingerprint is a value here rather than a select. None kept for another
 * reason, with no fingerprint, or with one too plain (design 164).
 */
export function keptGarmentFingerprint(
  db: Db,
  reason: RemovalReason,
  item: Readonly<{ id: string; photoFingerprint: string | null }>,
  moderationActionId: string,
) {
  const fingerprint = item.photoFingerprint;
  if (reason !== "intimate" || fingerprint === null) return [];
  if (!isDistinctive(fingerprint)) return [];
  return [
    db.insert(removedFingerprints).values({
      id: newUlid(),
      fingerprint,
      photoId: item.id,
      moderationActionId,
      createdAt: nowSeconds(),
    }),
  ];
}

/**
 * The kept fingerprint nearest to `fingerprint`, when one is within the
 * match distance: how many bits apart, and when the image it describes was
 * removed. Nothing when none is close, or when `fingerprint` is too plain
 * to match anything by (design 164).
 */
export interface RemovedMatch {
  readonly distance: number;
  readonly removedAt: number;
}

export async function removedMatchOf(
  db: Db,
  fingerprint: string,
): Promise<RemovedMatch | undefined> {
  const near = keptNear(fingerprint);
  if (near === undefined) return undefined;
  const [nearest] = await db
    .select({ distance: near.distance, removedAt: removedFingerprints.createdAt })
    .from(removedFingerprints)
    .where(near.within)
    .orderBy(...near.nearestFirst)
    .limit(1);
  return nearest;
}

/**
 * Whether an upload with `fingerprint` is held for review as a copy of a
 * removed image (D-147): it is near one, and the fingerprint breaker
 * (design 164) has room this hour. Past the ceiling a match is not held,
 * and the upload goes to the classifier like every other photo, so a bug in
 * matching hides a few photos an hour rather than every upload.
 *
 * The match is read first: the ordinary upload matches nothing, and pays
 * for no count.
 */
export async function isHeldAsRemovedCopy(
  db: Db,
  fingerprint: string,
  now: number,
): Promise<boolean> {
  if ((await removedMatchOf(db, fingerprint)) === undefined) return false;
  const reading = await ceilingReading(db, "fingerprint", now);
  return !reading.isOver;
}

/**
 * The pieces of a read of the kept fingerprints near `fingerprint`: the
 * distance as a number, the filter to the match distance, and the order,
 * nearest first and the earliest of equals. None for a fingerprint too
 * plain to match by: near one of those is near half the uploads.
 */
function keptNear(fingerprint: string) {
  // Parsed, not trusted: it is spelt into the SQL.
  const parsed = fingerprintSchema.parse(fingerprint);
  if (!isDistinctive(parsed)) return;
  const own = [parsed];
  const bits = nearestOf(removedFingerprints.fingerprint, own);
  return {
    distance: sql<number>`${bits}`.mapWith(Number),
    within: lte(bits, FINGERPRINT_MATCH_DISTANCE),
    nearestFirst: [asc(bits), asc(removedFingerprints.createdAt)] as const,
  };
}

/**
 * A removed image near a held photo, as Review's REMOVED tile names it
 * (round 41 #84, round 42): which photo it was — a kit photo, or a garment
 * by the garment's id — and whose, by @handle when they have one. The
 * image itself is never shown again.
 */
export type RemovedImage = RemovedMatch &
  Readonly<{
    /**
    The kept row: one image removed twice is two rows with one photo id.
    */
    keptId: string;
    id: string;
    kind: "kit" | "garment";
    handle: string | undefined;
  }>;

/**
 * Every removed image within the match distance of each held photo on a
 * page of Review rows, nearest first (round 42: a second removal in range
 * is a repeat upload, and the operator sees it), by photo id. A photo
 * gone since, or with no fingerprint, is not read at all, so the map has
 * no entry for it; one with nothing near has an empty list.
 */
export async function removedMatchesOf(
  db: Db,
  photoIds: readonly string[],
): Promise<Map<string, readonly RemovedImage[]>> {
  // A kit photo by its id, or a garment's photo by the garment's (design
  // 157): ids are ULIDs, so one list serves both tables. Each fingerprint
  // is typed as present: its `WHERE` keeps no row without one.
  const ids = [...photoIds];
  const kitPrint = entryPhotos.fingerprint;
  const garmentPrint = wardrobeItems.photoFingerprint;
  const kits = and(inArray(entryPhotos.id, ids), isNotNull(kitPrint));
  const garments = and(inArray(wardrobeItems.id, ids), isNotNull(garmentPrint));
  const [kitPhotos, garmentPhotos] = await db.batch([
    db
      .select({ id: entryPhotos.id, fingerprint: sql<string>`${kitPrint}` })
      .from(entryPhotos)
      .where(kits),
    db
      .select({
        id: wardrobeItems.id,
        fingerprint: sql<string>`${garmentPrint}`,
      })
      .from(wardrobeItems)
      .where(garments),
  ]);
  const photos = [...kitPhotos, ...garmentPhotos];
  const answers = await Promise.all(
    photos.map(
      async (photo) =>
        [photo.id, await removedImagesNear(db, photo.fingerprint)] as const,
    ),
  );
  return new Map(answers);
}

/**
 * The kept fingerprints within the match distance of `fingerprint`,
 * nearest first and the earliest of equals, each with the Remove that
 * kept it: its subject names the photo where the kept row has no id of
 * its own, and its owner gives the handle. A kept row always has its
 * Remove (one batch writes both, and one sweeps both).
 */
async function removedImagesNear(
  db: Db,
  fingerprint: string,
): Promise<RemovedImage[]> {
  const near = keptNear(fingerprint);
  if (near === undefined) return [];
  const rows = await db
    .select({
      distance: near.distance,
      removedAt: removedFingerprints.createdAt,
      keptId: removedFingerprints.id,
      id: sql<string>`coalesce(${removedFingerprints.photoId}, ${moderationActions.subjectId})`,
      subjectType: moderationActions.subjectType,
      handle: userProfiles.username,
    })
    .from(removedFingerprints)
    .innerJoin(
      moderationActions,
      eq(moderationActions.id, removedFingerprints.moderationActionId),
    )
    .leftJoin(
      userProfiles,
      eq(userProfiles.userId, moderationActions.subjectOwnerId),
    )
    .where(near.within)
    .orderBy(...near.nearestFirst);
  return rows.map(({ subjectType, handle, ...row }) => ({
    ...row,
    kind: subjectType === "garment" ? "garment" : "kit",
    handle: handle ?? undefined,
  }));
}
