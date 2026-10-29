/**
 * What hiding a kit purges from the edge (design 160): the kit's own page
 * and card, and its runner's profile, which lists it. A report's hide and
 * a takedown request's hold know the kit by its id alone, so its runner is
 * read here; a kit that is gone by then still names its own page.
 */
import { eq } from "drizzle-orm";
import type { DrizzleD1Database } from "drizzle-orm/d1";

import { outfitEntries } from "../../db/schema-core";
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
