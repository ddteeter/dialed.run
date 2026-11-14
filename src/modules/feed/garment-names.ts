import { inArray } from "drizzle-orm";
import type { DrizzleD1Database } from "drizzle-orm/d1";

import { wardrobeItems } from "../../db/schema-core";
import { readInChunks } from "../../lib/chunked";
import { garmentLabel } from "../../lib/garment-label";

/**
 * Garment names by id, for the ids given.
 *
 * The feed and a profile both need this and had written it out
 * identically, differing only in what they called the map —
 * `garmentNameById` and `nameById`. That is the copy-then-rename `mild`
 * mode cannot see.
 *
 * `consensus.ts` reads the same table in chunks too, and is deliberately
 * *not* folded in here: it selects `category` and `layer` and maps them
 * through `uiGroupFor`, so sharing a helper would mean one function
 * generic over its own projection, coupling "what the feed shows a person"
 * to "what consensus groups by". Two reads that rhyme, which is what
 * `fallow-ignore` is for if it ever comes to that.
 */
export async function garmentNamesByIds(
  database: DrizzleD1Database,
  itemIds: readonly string[],
  options: Readonly<{ withBrand?: boolean }> = {},
): Promise<Map<string, string>> {
  const garments = await garmentsByIds(database, itemIds);
  return new Map(
    garments.map((garment) => [
      garment.id,
      options.withBrand === true ? withBrand(garment) : garment.name,
    ]),
  );
}

/**
 * A garment as the closet names it, brand and model (`garmentLabel`).
 * G's Most worn reads it so (R55·209c), as D does: "Balega Hidden
 * Comfort", not "Hidden Comfort". A piece with no brand is generic (D's
 * `[GENERIC]`), and `garmentLabel` gives its name alone.
 */
function withBrand(garment: { name: string; brand: string | null }): string {
  return garmentLabel({ ...garment, isGeneric: false });
}

/**
 * The read behind it: in chunks, since the backlog asks for every
 * garment across fifty kits, past D1's 100-parameter cap for one
 * statement.
 */
function garmentsByIds(
  database: DrizzleD1Database,
  itemIds: readonly string[],
): Promise<{ id: string; name: string; brand: string | null }[]> {
  return readInChunks(itemIds, (chunk) =>
    database
      .select({
        id: wardrobeItems.id,
        name: wardrobeItems.name,
        brand: wardrobeItems.brand,
      })
      .from(wardrobeItems)
      .where(inArray(wardrobeItems.id, chunk)),
  );
}
