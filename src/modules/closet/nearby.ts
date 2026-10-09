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
import {
  and,
  desc,
  eq,
  getTableColumns,
  inArray,
  lte,
  or,
  sql,
} from "drizzle-orm";
import type { drizzle } from "drizzle-orm/d1";
import { alias } from "drizzle-orm/sqlite-core";

import { wardrobeItems } from "../../db/schema-core";
import { garmentCategories } from "../../lib/contracts";
import { garmentTypesFor } from "../../lib/contracts/garment-fields";
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
 * The categories whose types are listed past the category's own five.
 * F shows the type picker only where a category has more than one type,
 * so in a one-type category the category is the type: its pieces of that
 * type are the ones among the category's five, and asking again for the
 * type's own five would read the same rows twice for a card that lists
 * the category.
 */
const pickedCategories = garmentCategories.filter(
  (category) => garmentTypesFor(category).length > 1,
);

const RANKED = "ranked";

/**
 * `ranked`'s garment columns, typed as the table's and read through the
 * subquery's name. A subquery's fields are flat, and its rows carry the
 * ranks as well; selecting this alias — whose name is the subquery's —
 * reads back exactly a `wardrobe_items` row, decoded as one, so what
 * reaches the card is the row the rest of the closet reads.
 */
const rankedItem = /*#__PURE__*/ alias(wardrobeItems, RANKED);

/**
 * The runner's whole closet, read once by `wardrobe_user_category`'s
 * `user_id`, each row ranked newest first within its category (`rc`) and
 * within its category and type (`rt`) — the same order, `created_at` then
 * `id`, both descending, that the card lists in.
 */
function ranked(db: Db, userId: string) {
  const newest = sql`order by ${wardrobeItems.createdAt} desc, ${wardrobeItems.id} desc`;
  return db
    .select({
      ...getTableColumns(wardrobeItems),
      rc: sql<number>`row_number() over (partition by ${wardrobeItems.category} ${newest})`.as(
        "rc",
      ),
      rt: sql<number>`row_number() over (partition by ${wardrobeItems.category}, ${wardrobeItems.type} ${newest})`.as(
        "rt",
      ),
    })
    .from(wardrobeItems)
    .where(eq(wardrobeItems.userId, userId))
    .as(RANKED);
}

/**
 * Adds a piece to one list, unless the list is full.
 */
function listInto(
  lists: Partial<Record<string, ClosetItemView[]>>,
  key: string,
  view: ClosetItemView,
): void {
  const listed = lists[key] ?? [];
  if (listed.length === NEARBY_LIMIT) return;
  listed.push(view);
  lists[key] = listed;
}

/**
 * A row whose type is one of its own category's, in a category with a
 * picker: a type's five are that category's pieces of it, never a stray
 * row of another category that happens to carry the name.
 */
function ofPickedType() {
  return or(
    ...pickedCategories.map((category) =>
      and(
        eq(rankedItem.category, category),
        inArray(rankedItem.type, garmentTypesFor(category)),
      ),
    ),
  );
}

/**
 * Every category's newest five and every picked type's, in one statement
 * that reads the closet once: a row is kept when it is among its
 * category's five, or among its type's five in a category with a picker.
 *
 * **The lists are assembled from what the statement kept, in its order**,
 * and that is not an in-memory filter — the `WHERE` already chose every
 * row. Newest first, a category's own five come before any older row its
 * types kept, so its list is full before one reaches it; and every row of
 * a type the statement kept is among that type's newest five (a row in
 * its category's five is in its type's too), so a type's list is exactly
 * its rows, in order.
 */
export function nearbyStatement(db: Db, userId: string) {
  const rows = ranked(db, userId);
  const inTypesFive = and(lte(rows.rt, NEARBY_LIMIT), ofPickedType());
  return db
    .select({ item: rankedItem })
    .from(rows)
    .where(or(lte(rows.rc, NEARBY_LIMIT), inTypesFive))
    .orderBy(desc(rankedItem.createdAt), desc(rankedItem.id));
}

/**
 * The card's lists, from `nearbyStatement`'s rows.
 */
export async function closetNearby(
  db: Db,
  userId: string,
): Promise<ClosetNearby> {
  const found = await nearbyStatement(db, userId);
  const views = await viewsOf(
    db,
    userId,
    found.map((row) => row.item),
  );
  const nearby: ClosetNearby = { byCategory: {}, byType: {} };
  for (const view of views) {
    listInto(nearby.byCategory, view.item.category, view);
    if (view.item.type !== null) listInto(nearby.byType, view.item.type, view);
  }
  return nearby;
}
