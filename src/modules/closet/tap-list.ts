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
import { createItem } from "./service";
import type { WardrobeItemRow } from "./service";
import { climateBands, TAP_LISTS } from "./tap-list-data";
import type { ClimateBand, TapListEntry } from "./tap-list-data";

type Db = ReturnType<typeof drizzle>;

export { climateBands, TAP_LISTS } from "./tap-list-data";
export type { ClimateBand, TapListEntry } from "./tap-list-data";

export const climateBandSchema = z.enum(climateBands);

function findEntry(band: ClimateBand, key: string): TapListEntry | undefined {
  return TAP_LISTS[band].find((candidate) => candidate.key === key);
}

export const tapListSelectionSchema = z.object({
  band: climateBandSchema,
  keys: z
    .array(z.string())
    .min(1)
    .max(TAP_LISTS.cold.length + TAP_LISTS.mild.length),
});
export type TapListSelection = z.infer<typeof tapListSelectionSchema>;

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
  for (const key of selection.keys) {
    const found = findEntry(selection.band, key);
    if (!found) continue;
    const parsed = garmentSchema.parse(found.garment);
    created.push(await createItem(db, userId, parsed, "taplist"));
  }
  return created;
}
