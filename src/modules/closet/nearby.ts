import { and, eq, ne } from "drizzle-orm";
import type { drizzle } from "drizzle-orm/d1";

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
 * One list the card may show: its first five, and how many more there
 * are, for "+ 5 more tops" (Round 55 · 193).
 */
export interface NearbyList {
  pieces: ClosetItemView[];
  more: number;
}

/**
 * The lists the card may show, by category and by type; a category or a
 * type with no pieces is absent. `byType` is keyed by the stored column,
 * which the card reads with a contract type.
 */
export interface ClosetNearby {
  byCategory: Partial<Record<Category, NearbyList>>;
  byType: Partial<Record<string, NearbyList>>;
}

/**
 * Whether a piece's type gets a list of its own. F shows the type picker
 * only where a category has more than one type, so in a one-type category
 * the category is the type, and a stored type the category does not allow
 * is no type at all.
 */
function listedType(view: ClosetItemView): string | undefined {
  const types: readonly string[] = garmentTypesFor(view.item.category);
  const { type } = view.item;
  return type !== null && types.length > 1 && types.includes(type)
    ? type
    : undefined;
}

/**
 * Round 55 · 193's order: pieces in use first, most worn first, then the
 * retired ones. Within a tie, newest first, then by id, so the order is
 * the same on every read.
 */
export function nearbyOrder(a: ClosetItemView, b: ClosetItemView): number {
  const runs = (view: ClosetItemView): number =>
    view.performance?.summary.runCount ?? 0;
  return (
    Number(a.item.retired) - Number(b.item.retired) ||
    runs(b) - runs(a) ||
    b.item.createdAt - a.item.createdAt ||
    b.item.id.localeCompare(a.item.id)
  );
}

/**
The first five of a list in order, and the count of the rest.
*/
function capped(views: readonly ClosetItemView[]): NearbyList {
  return {
    pieces: views.slice(0, NEARBY_LIMIT),
    more: Math.max(0, views.length - NEARBY_LIMIT),
  };
}

/**
 * The runner's whole closet, in one read by a runner's index, in no
 * order: `nearbyOrder` decides the whole order, ties included, so an
 * `ORDER BY` would only add a sort.
 *
 * **The lists are ordered and cut in code, and that is the one exception
 * the D1 rule allows**: "most worn" is the runs history, which
 * `viewsOf` already reads for every piece (`computeUserPerformance`) and
 * no column holds, so no `ORDER BY` here could say it. The rows scanned
 * are the closet's either way; the old statement's window functions read
 * all of them too.
 */
export function nearbyStatement(
  db: Db,
  userId: string,
  exceptItemId?: string,
) {
  return db
    .select()
    .from(wardrobeItems)
    .where(
      and(
        eq(wardrobeItems.userId, userId),
        exceptItemId === undefined
          ? undefined
          : ne(wardrobeItems.id, exceptItemId),
      ),
    );
}

/**
 * The card's lists, from `nearbyStatement`'s rows; on a piece's edit form,
 * without that piece, which is not "already in your closet" beside itself.
 */
export async function closetNearby(
  db: Db,
  userId: string,
  exceptItemId?: string,
): Promise<ClosetNearby> {
  const rows = await nearbyStatement(db, userId, exceptItemId);
  const read = await viewsOf(db, userId, rows);
  const views = read.toSorted(nearbyOrder);
  const byCategory = new Map<Category, ClosetItemView[]>();
  const byType = new Map<string, ClosetItemView[]>();
  for (const view of views) {
    byCategory.set(view.item.category, [
      ...(byCategory.get(view.item.category) ?? []),
      view,
    ]);
    const type = listedType(view);
    if (type !== undefined) byType.set(type, [...(byType.get(type) ?? []), view]);
  }
  return {
    byCategory: Object.fromEntries(
      [...byCategory].map(([category, list]) => [category, capped(list)]),
    ),
    byType: Object.fromEntries(
      [...byType].map(([type, list]) => [type, capped(list)]),
    ),
  };
}
