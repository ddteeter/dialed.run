import { eq, sql } from "drizzle-orm";
import type { DrizzleD1Database } from "drizzle-orm/d1";

import { outfitEntryItems, wardrobeItems } from "../../db/schema-core";

/**
 * A kit's pieces, in the order they were put on it: the kit's open page
 * (`feed/public-kit.ts`) and the Desk's view of it (`desk-kit.ts`, #388)
 * read them alike, each taking what it shows. Here because feed and closet
 * both import safety, so this is the one module both callers reach
 * without a cycle.
 *
 * The order is the attaching one: the table has no position column, and
 * its index would otherwise hand them back by item id. Served by
 * `entry_items_pk`'s `entry_id` prefix. Columns are built on first use,
 * not at module scope, so nothing here keeps the schema alive in a bundle
 * that only names this file.
 */
export function kitPiecesSelect(
  database: DrizzleD1Database<Record<string, unknown>>,
  entryId: string,
) {
  return database
    .select({
      id: wardrobeItems.id,
      name: wardrobeItems.name,
      brand: wardrobeItems.brand,
      category: wardrobeItems.category,
      type: wardrobeItems.type,
      productUrl: wardrobeItems.productUrl,
    })
    .from(outfitEntryItems)
    .innerJoin(wardrobeItems, eq(wardrobeItems.id, outfitEntryItems.itemId))
    .where(eq(outfitEntryItems.entryId, entryId))
    .orderBy(sql`${outfitEntryItems}.rowid`);
}
