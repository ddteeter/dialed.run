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
import { and, desc, eq } from "drizzle-orm";
import type { drizzle } from "drizzle-orm/d1";

import { wardrobeItems } from "../../db/schema-core";
import { garmentCategories } from "../../lib/contracts";
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
 * The newest five of one category, found by `wardrobe_user_category` —
 * in SQL, so the limit is the category's and not the closet's.
 */
function newestIn(db: Db, userId: string, category: Category) {
  return db
    .select()
    .from(wardrobeItems)
    .where(
      and(
        eq(wardrobeItems.userId, userId),
        eq(wardrobeItems.category, category),
      ),
    )
    .orderBy(desc(wardrobeItems.createdAt), desc(wardrobeItems.id))
    .limit(NEARBY_LIMIT);
}

/**
 * Every category's newest five, one statement a category, in one batch
 * — one round trip. Split from the tuple rather than mapped whole, so the
 * batch is given the non-empty list it asks for without a check that no
 * input could fail.
 */
export async function closetNearby(
  db: Db,
  userId: string,
): Promise<ClosetNearby> {
  const [first, ...rest] = garmentCategories;
  const found = await db.batch([
    newestIn(db, userId, first),
    ...rest.map((category) => newestIn(db, userId, category)),
  ]);
  const views = await viewsOf(db, userId, found.flat());
  const nearby: ClosetNearby = {};
  for (const view of views) {
    const listed = nearby[view.item.category] ?? [];
    listed.push(view);
    nearby[view.item.category] = listed;
  }
  return nearby;
}
