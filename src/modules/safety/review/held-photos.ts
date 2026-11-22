/**
 * The runner's photos the classifier sent to Review that are still
 * waiting: kit photos and garment photos alike, pending or in a
 * reviewer's hands. At `PHOTOS_HELD_AT_ONCE` of them the upload paths
 * take no new photo until some are decided.
 */
import { and, inArray, sql } from "drizzle-orm";

import { reviewQueue } from "../../../db/schema-core";
import { primaryCoreDb } from "../../../env";
import { PHOTOS_HELD_AT_ONCE } from "../../../lib/photo-constraints";
import { subjectOwner } from "./review";

/**
 * Whether the runner already has as many held photos waiting as they may.
 * Read from the primary, since the answer decides whether an upload is
 * written. Only the classifier's holds count: a row reports opened is
 * other people's doing, not the runner's.
 */
export async function hasPhotosHeldAtLimit(userId: string): Promise<boolean> {
  // No more rows than the answer needs: past the limit, more are the same.
  const held = await primaryCoreDb()
    .select({ id: reviewQueue.id })
    .from(reviewQueue)
    .where(
      and(
        // The unary plus keeps SQLite off the index on source, which holds
        // every classifier row ever filed; the status index reads only the
        // open ones.
        sql`+${reviewQueue.source} = ${"classifier"}`,
        inArray(reviewQueue.status, ["pending", "reviewing"]),
        inArray(reviewQueue.subjectType, ["photo", "garment"]),
        sql`${subjectOwner()} = ${userId}`,
      ),
    )
    .limit(PHOTOS_HELD_AT_ONCE);
  return held.length >= PHOTOS_HELD_AT_ONCE;
}
