/**
 * What hiding a kit purges from the edge (design 161): the kit's own page
 * and card, and its runner's profile, which lists it. A report's hide and
 * a takedown request's hold know the kit by its id alone, so its runner is
 * read here; a kit that is gone by then still names its own page.
 */
import { eq } from "drizzle-orm";
import type { DrizzleD1Database } from "drizzle-orm/d1";

import { entryPhotos, outfitEntries } from "../../db/schema-core";
import { entryCacheTag, kitCacheTags } from "../../lib/cache-tags";
import { firstColumnWhere } from "../../lib/sql/keyed-read";

export async function kitCacheTagsOf(
  db: DrizzleD1Database<Record<string, unknown>>,
  entryId: string,
): Promise<string[]> {
  const runnerId = await firstColumnWhere(
    db,
    outfitEntries,
    outfitEntries.userId,
    eq(outfitEntries.id, entryId),
  );
  return runnerId === undefined
    ? [entryCacheTag(entryId)]
    : kitCacheTags(runnerId, entryId);
}

/**
 * What hiding or holding a report's or a removal request's subject
 * purges: a kit's tags, a photo's kit's, and nothing for a profile or a
 * product, which hide nothing on the open web (a profile is a ban's to
 * take down).
 *
 * A photo (design 161 step 8) purges the page of the kit it is on, which
 * shows it while the kit is PUBLIC, read here because a report and a
 * takedown request know the photo by its id alone. The purge also deletes
 * the photo's public copy. Nothing for a photo that is gone (its kit's own
 * deletion purged then).
 */
export async function subjectCacheTagsOf(
  db: DrizzleD1Database<Record<string, unknown>>,
  subjectType: string,
  subjectId: string,
): Promise<string[]> {
  if (subjectType === "entry") return kitCacheTagsOf(db, subjectId);
  if (subjectType !== "photo") return [];
  const photoEntryId = await firstColumnWhere(
    db,
    entryPhotos,
    entryPhotos.entryId,
    eq(entryPhotos.id, subjectId),
  );
  return photoEntryId === undefined ? [] : kitCacheTagsOf(db, photoEntryId);
}
