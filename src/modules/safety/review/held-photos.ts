/**
 * The runner's photos the classifier has not let through yet: those it
 * sent to Review that are still waiting, pending or in a reviewer's
 * hands, and those still waiting to be screened at all, kit photos and
 * garment photos alike. At `PHOTOS_HELD_AT_ONCE` of them the upload paths
 * take no new photo until some are through.
 */
import { and, eq, inArray, isNotNull, sql, type SQL } from "drizzle-orm";

import {
  entryPhotos,
  outfitEntries,
  reviewQueue,
  wardrobeItems,
} from "../../../db/schema-core";
import type { primaryCoreDb } from "../../../env";
import { PHOTOS_HELD_AT_ONCE } from "../../../lib/photo-constraints";
import { subjectOwner } from "./review";

/**
 * Whether the runner has room for one more photo held or waiting to be
 * screened, as a condition: read from the primary by the upload paths
 * before anything is stored, and carried by the photo's own write, where
 * uploads sent together are counted one after another, each seeing the
 * rows written before it. Only the classifier's holds count: a row
 * reports opened is other people's doing, not the runner's. A photo still
 * waiting to be screened counts too, so uploads sent together are counted
 * as each one's row lands, not only once the classifier has answered.
 */
export function photosHeldBelowLimit(db: Db, userId: string): SQL {
  const counts = [
    heldRows(db, userId),
    kitPhotosWaiting(db, userId),
    garmentPhotosWaiting(db, userId),
  ].map((rows) => sql`(select count(*) from (${rows}))`);
  const total = sql.join(counts, sql.raw(" + "));
  return sql`(${total}) < ${PHOTOS_HELD_AT_ONCE}`;
}

type Db = Pick<ReturnType<typeof primaryCoreDb>, "select">;

/**
 * The classifier's open rows about the runner's photos, no more than the
 * answer needs: past the limit, more are the same.
 */
function heldRows(db: Db, userId: string) {
  // The unary plus keeps SQLite off the index on source, which holds
  // every classifier row ever filed; the status index reads only the
  // open ones.
  const held = and(
    sql`+${reviewQueue.source} = ${"classifier"}`,
    inArray(reviewQueue.status, ["pending", "reviewing"]),
    inArray(reviewQueue.subjectType, ["photo", "garment"]),
    sql`${subjectOwner()} = ${userId}`,
  );
  return db
    .select({ id: reviewQueue.id })
    .from(reviewQueue)
    .where(held)
    .limit(PHOTOS_HELD_AT_ONCE);
}

/**
The runner's kit photos still waiting to be screened.
*/
function kitPhotosWaiting(db: Db, userId: string) {
  const waiting = and(
    eq(entryPhotos.screenStatus, "pending"),
    eq(outfitEntries.userId, userId),
  );
  return db
    .select({ id: entryPhotos.id })
    .from(entryPhotos)
    .innerJoin(outfitEntries, eq(outfitEntries.id, entryPhotos.entryId))
    .where(waiting)
    .limit(PHOTOS_HELD_AT_ONCE);
}

/**
The runner's garment photos still waiting to be screened.
*/
function garmentPhotosWaiting(db: Db, userId: string) {
  const waiting = and(
    eq(wardrobeItems.userId, userId),
    eq(wardrobeItems.visibility, "pending"),
    isNotNull(wardrobeItems.photoKey),
  );
  return db
    .select({ id: wardrobeItems.id })
    .from(wardrobeItems)
    .where(waiting)
    .limit(PHOTOS_HELD_AT_ONCE);
}
