/**
 * F at the desk's one rail card, "Already in your closet" (round 26 #10,
 * task 128 · SAF-18): the runner's pieces in each category, newest first,
 * up to five, retired ones included — re-adding a retired piece is the
 * likeliest duplicate.
 *
 * Every category is read at once, because the category is picked on the
 * form after the page has loaded and the card follows it without a round
 * trip. That is at most forty rows.
 */
import { desc, eq, getTableColumns, lte, sql } from "drizzle-orm";
import type { drizzle } from "drizzle-orm/d1";

import { wardrobeItems } from "../../db/schema-core";
import type { garmentCategories } from "../../lib/contracts";
import { viewsOf, type ClosetItemView } from "./service";

type Db = ReturnType<typeof drizzle>;

type Category = (typeof garmentCategories)[number];

/**
The most pieces the card lists for a category.
*/
export const NEARBY_LIMIT = 5;

/**
The pieces the card may list, by category; a category with none is absent.
*/
export type ClosetNearby = Partial<Record<Category, ClosetItemView[]>>;

/**
 * Up to five per category in one statement: each row ranked within its
 * category, newest first, and only the first five kept — in SQL, so the
 * limit is per category and not over the closet as a whole. The runner's
 * rows are found by `wardrobe_user_category`.
 */
export async function closetNearby(
  db: Db,
  userId: string,
): Promise<ClosetNearby> {
  const ranked = db
    .select({
      ...getTableColumns(wardrobeItems),
      rank: sql<number>`row_number() over (partition by ${wardrobeItems.category} order by ${wardrobeItems.createdAt} desc, ${wardrobeItems.id} desc)`.as(
        "rank",
      ),
    })
    .from(wardrobeItems)
    .where(eq(wardrobeItems.userId, userId))
    .as("ranked");
  const rows = await db
    .select()
    .from(ranked)
    .where(lte(ranked.rank, NEARBY_LIMIT))
    .orderBy(desc(ranked.createdAt), desc(ranked.id));
  const views = await viewsOf(db, userId, rows);
  const nearby: ClosetNearby = {};
  for (const view of views) {
    const listed = nearby[view.item.category] ?? [];
    listed.push(view);
    nearby[view.item.category] = listed;
  }
  return nearby;
}
