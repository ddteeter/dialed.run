import { inArray } from "drizzle-orm";
import type { DrizzleD1Database } from "drizzle-orm/d1";

import { wardrobeItems } from "../../db/schema-core";
import { forIds } from "../../lib/for-ids";

/**
 * Garment names by id, for the ids given.
 *
 * The feed and a profile both need this and had written it out
 * identically, differing only in what they called the map —
 * `garmentNameById` and `nameById`. That is the copy-then-rename `mild`
 * mode cannot see.
 *
 * `consensus.ts` reads the same table through `forIds` and is deliberately
 * *not* folded in here: it selects `category` and `layer` and maps them
 * through `uiGroupFor`, so sharing a helper would mean one function
 * generic over its own projection, coupling "what the feed shows a person"
 * to "what consensus groups by". Two reads that rhyme, which is what
 * `fallow-ignore` is for if it ever comes to that.
 */
export async function garmentNamesByIds(
  database: DrizzleD1Database,
  itemIds: readonly string[],
): Promise<Map<string, string>> {
  // fallow-ignore-next-line code-duplication -- the forIds+inArray shape rhymes with backlog.ts's kitsFor, but against a different table for a different key (item ids -> names, not entry ids -> item pairs); see the note above on why a shared helper is not wanted here
  const garments = await forIds(itemIds, () =>
    database
      .select({ id: wardrobeItems.id, name: wardrobeItems.name })
      .from(wardrobeItems)
      .where(inArray(wardrobeItems.id, [...itemIds])),
  );
  return new Map(garments.map((garment) => [garment.id, garment.name]));
}
