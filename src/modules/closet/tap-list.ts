/**
 * Curated per-climate starter lists (docs/product.md O3 "fill the long
 * tail"): a static table of generic category defaults keyed by a rough
 * climate band, plus the server-side write path. Lane 105 builds the
 * onboarding picker UI on top of `TAP_LISTS`; this module only owns the
 * data and `addFromTapList`.
 */
import type { drizzle } from "drizzle-orm/d1";
import { z } from "zod";

import type { Garment } from "../../lib/contracts";
import { garmentSchema } from "../../lib/contracts";
import { createItem } from "./service";
import type { WardrobeItemRow } from "./service";

type Db = ReturnType<typeof drizzle>;

export const climateBands = ["cold", "mild", "hot"] as const;
export const climateBandSchema = z.enum(climateBands);
export type ClimateBand = z.infer<typeof climateBandSchema>;

export interface TapListEntry {
  /**
  Stable key within a band — what the onboarding UI sends back.
  */
  key: string;
  garment: Garment;
}

function entry(key: string, garment: Garment): TapListEntry {
  return { key, garment };
}

/**
 * Hand-curated, not learned (docs/product.md O3): the five-ish things most
 * runners in each band actually reach for, as generic (no product link)
 * category placeholders — the whole point of D-27's upgrade path.
 */
export const TAP_LISTS: Record<ClimateBand, readonly TapListEntry[]> = {
  cold: [
    entry("cold-base-top", {
      category: "top",
      name: "Long sleeve base layer",
      layer: "base",
      weight: "mid",
    }),
    entry("cold-outer-top", {
      category: "top",
      name: "Wind jacket",
      layer: "outer",
      weight: "light",
      windResistant: true,
    }),
    entry("cold-tights", {
      category: "bottom",
      name: "Running tights",
      layer: "base",
      weight: "mid",
    }),
    entry("cold-gloves", {
      category: "gloves",
      name: "Running gloves",
      weight: "mid",
    }),
    entry("cold-beanie", {
      category: "headwear",
      name: "Beanie",
      weight: "mid",
    }),
  ],
  mild: [
    entry("mild-tee", {
      category: "top",
      name: "Short sleeve tee",
      layer: "base",
      weight: "light",
    }),
    entry("mild-long-sleeve", {
      category: "top",
      name: "Long sleeve quarter-zip",
      layer: "mid",
      weight: "mid",
    }),
    entry("mild-shorts", {
      category: "bottom",
      name: "Running shorts",
      layer: "base",
      weight: "light",
    }),
    entry("mild-socks", {
      category: "socks",
      name: "Running socks",
      weight: "mid",
    }),
    entry("mild-cap", {
      category: "headwear",
      name: "Running cap",
      weight: "light",
    }),
  ],
  hot: [
    entry("hot-singlet", {
      category: "top",
      name: "Singlet",
      layer: "base",
      weight: "light",
    }),
    entry("hot-shorts", {
      category: "bottom",
      name: "Split shorts",
      layer: "base",
      weight: "light",
    }),
    entry("hot-socks", {
      category: "socks",
      name: "No-show socks",
      weight: "light",
    }),
    entry("hot-cap", {
      category: "headwear",
      name: "Running cap",
      weight: "light",
    }),
    entry("hot-sunglasses", {
      category: "accessory",
      name: "Running sunglasses",
    }),
  ],
};

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
