/**
 * F at the desk's one rail card, "Already in your closet" (round 26 #10,
 * task 128 · SAF-18): the runner's pieces in each category, and in each
 * type, newest first, up to five, retired ones included — re-adding a
 * retired piece is the likeliest duplicate.
 *
 * Every category and every type is read at once, because both are picked
 * on the form after the page has loaded and the card follows them without
 * a round trip. Round 26 matches on "same category and type" (R-112), so
 * a type gets its own newest five **in SQL**: narrowing a category's five
 * by type would answer "the survivors of the first five", and a runner
 * whose five newest tops are tees would be told they own no half-zips.
 */
import { and, desc, eq } from "drizzle-orm";
import type { drizzle } from "drizzle-orm/d1";

import { wardrobeItems } from "../../db/schema-core";
import { garmentCategories } from "../../lib/contracts";
import {
  garmentTypesFor,
  type GarmentType,
} from "../../lib/contracts/garment-fields";
import { viewsOf, type ClosetItemView } from "./service";

type Db = ReturnType<typeof drizzle>;

type Category = (typeof garmentCategories)[number];

/**
The most pieces the card lists for a category, or for a type.
*/
export const NEARBY_LIMIT = 5;

/**
 * The pieces the card may list, by category and by type; a category or a
 * type with none is absent. `byType` is keyed by the stored column, which
 * the card reads with a contract type.
 */
export interface ClosetNearby {
  byCategory: Partial<Record<Category, ClosetItemView[]>>;
  byType: Partial<Record<string, ClosetItemView[]>>;
}

/**
 * A category's newest five, or one of its types', found by
 * `wardrobe_user_category`. A type's query names its category too, so the
 * index narrows the scan to that category's rows before the type is read.
 */
function newestIn(
  db: Db,
  userId: string,
  category: Category,
  type?: GarmentType,
) {
  return db
    .select()
    .from(wardrobeItems)
    .where(
      and(
        eq(wardrobeItems.userId, userId),
        eq(wardrobeItems.category, category),
        type === undefined ? undefined : eq(wardrobeItems.type, type),
      ),
    )
    .orderBy(desc(wardrobeItems.createdAt), desc(wardrobeItems.id))
    .limit(NEARBY_LIMIT);
}

/**
A category's statement, then one for each of its types.
*/
function statementsFor(db: Db, userId: string, category: Category) {
  return garmentTypesFor(category).map((type) =>
    newestIn(db, userId, category, type),
  );
}

/**
 * Adds a piece to one list, unless the list already has it or is full.
 */
function listInto(
  lists: Partial<Record<string, ClosetItemView[]>>,
  key: string,
  view: ClosetItemView,
): void {
  const listed = lists[key] ?? [];
  if (listed.length === NEARBY_LIMIT) return;
  if (listed.some((held) => held.item.id === view.item.id)) return;
  listed.push(view);
  lists[key] = listed;
}

/**
 * Every category's newest five and every type's, one statement each, in
 * one batch — one round trip. Split from the categories' tuple rather
 * than mapped whole, so the batch is given the non-empty list it asks for
 * without a check that no input could fail.
 *
 * **The lists are assembled from what the statements found, in their
 * order**, and that is not an in-memory filter. Each category's
 * statement comes before its types', newest first. So a category's list
 * fills from its own statement and is full, or holds the whole category,
 * before any type's row reaches it; and a type's rows from the category's
 * statement are the newest of that type, which its own statement then
 * continues. A piece both statements found is listed once.
 */
export async function closetNearby(
  db: Db,
  userId: string,
): Promise<ClosetNearby> {
  const [first, ...rest] = garmentCategories;
  const found = await db.batch([
    newestIn(db, userId, first),
    ...statementsFor(db, userId, first),
    ...rest.flatMap((category) => [
      newestIn(db, userId, category),
      ...statementsFor(db, userId, category),
    ]),
  ]);
  const views = await viewsOf(db, userId, found.flat());
  const nearby: ClosetNearby = { byCategory: {}, byType: {} };
  for (const view of views) {
    listInto(nearby.byCategory, view.item.category, view);
    if (view.item.type !== null) listInto(nearby.byType, view.item.type, view);
  }
  return nearby;
}
