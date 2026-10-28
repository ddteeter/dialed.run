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
import { and, asc, inArray, isNotNull, lte, sql, type SQL } from "drizzle-orm";
import type { drizzle } from "drizzle-orm/d1";

import {
  entryPhotos,
  removedFingerprints,
  wardrobeItems,
} from "../../db/schema-core";
import { newUlid } from "../../lib/ids";
import { nowSeconds } from "../../lib/now";
import {
  FINGERPRINT_MATCH_DISTANCE,
  fingerprintSchema,
} from "../../lib/photo-fingerprint";
import { nearestOf } from "../../lib/sql/fingerprint-distance";
import type { RemovalReason } from "./contracts";

type Db = ReturnType<typeof drizzle>;

/**
 * Keeps the fingerprints of the photos `photosInScope` selects, as
 * statements for the Remove's batch, ahead of the delete that takes the
 * photos: in one batch they are read before they go. A photo with no
 * fingerprint keeps nothing, and any reason but `intimate` keeps nothing
 * at all.
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
      fingerprint: sql<string>`${entryPhotos.fingerprint}`.as(
        into.fingerprint.name,
      ),
      moderationActionId: sql<string>`${moderationActionId}`.as(
        into.moderationActionId.name,
      ),
      createdAt: sql<number>`${nowSeconds()}`.as(into.createdAt.name),
    })
    .from(entryPhotos)
    .where(and(photosInScope, isNotNull(entryPhotos.fingerprint)));
  return [db.insert(removedFingerprints).select(kept)];
}

/**
 * A garment's photo's fingerprint, kept when a person removes it as an
 * intimate image (R-167, design 159), as a kit photo's is. The garment was
 * read before the batch, so its one fingerprint is a value here rather
 * than a select. None kept for another reason, or with no fingerprint.
 */
export function keptGarmentFingerprint(
  db: Db,
  reason: RemovalReason,
  fingerprint: string | null,
  moderationActionId: string,
) {
  if (reason !== "intimate" || fingerprint === null) return [];
  return [
    db.insert(removedFingerprints).values({
      id: newUlid(),
      fingerprint,
      moderationActionId,
      createdAt: nowSeconds(),
    }),
  ];
}

/**
 * The kept fingerprint nearest to `fingerprint`, when one is within the
 * match distance: how many bits apart, and when the image it describes was
 * removed. Nothing when none is close.
 */
export interface RemovedMatch {
  readonly distance: number;
  readonly removedAt: number;
}

export async function removedMatchOf(
  db: Db,
  fingerprint: string,
): Promise<RemovedMatch | undefined> {
  // Parsed, not trusted: it is spelt into the SQL.
  const own = [fingerprintSchema.parse(fingerprint)];
  const distance = nearestOf(removedFingerprints.fingerprint, own);
  const [nearest] = await db
    .select({
      distance: sql<number>`${distance}`.mapWith(Number),
      removedAt: removedFingerprints.createdAt,
    })
    .from(removedFingerprints)
    .where(lte(distance, FINGERPRINT_MATCH_DISTANCE))
    .orderBy(asc(distance), asc(removedFingerprints.createdAt))
    .limit(1);
  return nearest;
}

/**
 * The nearest removed image for each held photo on a page of Review rows,
 * by photo id; `undefined` for one with none near. A photo gone since, or
 * with no fingerprint, is not read at all, so the map has no entry for it.
 */
export async function removedMatchesOf(
  db: Db,
  photoIds: readonly string[],
): Promise<Map<string, RemovedMatch | undefined>> {
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
        [photo.id, await removedMatchOf(db, photo.fingerprint)] as const,
    ),
  );
  return new Map(answers);
}
