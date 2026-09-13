/**
 * The tap-list write path (docs/product.md O3 "fill the long tail"): pick
 * from a curated per-climate starter list, get generic closet items.
 *
 * The table itself lives in `./tap-list-data` — see that file for why the
 * data and the behaviour are separate. Lane 105 builds the onboarding
 * picker UI on top of `TAP_LISTS`; this module owns the schema and the
 * write.
 */
import type { drizzle } from "drizzle-orm/d1";
import { z } from "zod";

import { garmentSchema } from "../../lib/contracts";
import type { TapListSelection } from "../../lib/contracts";
import { createItem } from "./service";
import type { WardrobeItemRow } from "./service";
import { climateBands, TAP_LIST } from "./tap-list-data";
import type { ClimateBand, TapListEntry } from "./tap-list-data";

type Db = ReturnType<typeof drizzle>;

export { climateBands, TAP_LIST, TAP_LIST_FOLD } from "./tap-list-data";
export type { ClimateBand, TapListEntry } from "./tap-list-data";

export const climateBandSchema = z.enum(climateBands);

function findEntry(key: string): TapListEntry | undefined {
  return TAP_LIST.find((candidate) => candidate.key === key);
}

/**
 * The list as one band sees it: same rows, its own order.
 *
 * The band is a sort key and never a filter (design round 6 §AA) — a
 * Minneapolis runner owns tights *and* a singlet, so mittens fall behind
 * the fold in Phoenix rather than out of existence.
 */
export function tapListFor(band: ClimateBand): TapListEntry[] {
  // `toSorted`, so the table itself is never reordered — `sort` mutates,
  // and the copy that avoids it is easy to forget when someone later
  // "simplifies" this line.
  return TAP_LIST.toSorted((a, b) => a.rank[band] - b.rank[band]);
}

/**
 * Re-exported, not declared: the shape lives in `lib/contracts.ts` because
 * O3's form and this write path both need the same schema object and a
 * component cannot reach this module's barrel. See the definition there.
 *
 * It carries no band. The band orders what a runner is shown and has
 * nothing to do with what they tapped — sending one would invite a reader
 * to think a key only means something inside a band, which was the old
 * shape.
 */
export { tapListSelectionSchema } from "../../lib/contracts";
export type { TapListSelection } from "../../lib/contracts";

/**
 * Creates one `origin='taplist'` wardrobe item per selected key. Unknown
 * keys are skipped rather than failing the whole batch — onboarding never
 * blocks on a stale client-side list.
 */
export async function addFromTapList(
  db: Db,
  userId: string,
  selection: TapListSelection,
): Promise<WardrobeItemRow[]> {
  const created: WardrobeItemRow[] = [];
  // Deduped, because a key repeated in the payload would otherwise create
  // the garment twice. The screen holds a `Set` so its own submissions
  // cannot repeat one, which is exactly why this needs saying here: the
  // server is the side that has to survive a payload the screen did not
  // build. It is also what lets the schema carry no length bound — the work
  // is bounded by the table, not by what was sent.
  const distinct = new Set(selection.keys);
  for (const key of distinct) {
    const found = findEntry(key);
    if (!found) continue;
    const parsed = garmentSchema.parse(found.garment);
    created.push(await createItem(db, userId, parsed, "taplist"));
  }
  return created;
}
