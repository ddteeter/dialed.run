import { and, eq, ne } from "drizzle-orm";
import type { drizzle } from "drizzle-orm/d1";

import { wardrobeItems } from "../../db/schema-core";
import type { UiGroup } from "../../lib/contracts";
import { viewsOf, type ClosetItemView } from "./service";

type Db = ReturnType<typeof drizzle>;

/**
 * Every piece in the closet, by the group screen C files it in, each
 * group whole and in `nearbyOrder` (Round 56 · 248). The group is the
 * view's own `uiGroup`, C's filing, so a top worn as an outer layer is
 * in Outer here as there, and the card cannot count what C will not show.
 * The card shows five and counts the rest; a group with no pieces is
 * absent.
 */
export type ClosetNearby = Partial<Record<UiGroup, ClosetItemView[]>>;

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
 * The runner's whole closet, in one read by a runner's index, in no
 * order: `nearbyOrder` decides the whole order, ties included, so an
 * `ORDER BY` would only add a sort.
 *
 * **The groups are ordered in code, and that is the one exception
 * the D1 rule allows**: "most worn" is the runs history, which
 * `viewsOf` already reads for every piece (`computeUserPerformance`) and
 * no column holds, so no `ORDER BY` here could say it. The rows scanned
 * are the closet's either way; the old statement's window functions read
 * all of them too.
 */
export function nearbyStatement(db: Db, userId: string, exceptItemId?: string) {
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
 * The card's groups, from `nearbyStatement`'s rows; on a piece's edit
 * form, without that piece, which is not "already in your closet" beside
 * itself.
 */
export async function closetNearby(
  db: Db,
  userId: string,
  exceptItemId?: string,
): Promise<ClosetNearby> {
  const rows = await nearbyStatement(db, userId, exceptItemId);
  const views = await viewsOf(db, userId, rows);
  return Object.fromEntries(
    Map.groupBy(views.toSorted(nearbyOrder), (view) => view.uiGroup),
  );
}
