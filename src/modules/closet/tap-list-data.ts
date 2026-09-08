/**
 * The tap-list table itself — data, kept apart from the behaviour that
 * reads it (`./tap-list`).
 *
 * Split out for two reasons. It is a table, so every row necessarily has
 * the shape of every other row, and a semantic clone detector reads the
 * whole thing as one 52-line duplicate; `.fallowrc.jsonc` can ignore this
 * file without also blinding itself to `addFromTapList` (D-34). And it is
 * the file design will hand edits to when P2 changes, which is a different
 * kind of change from touching the write path.
 *
 * Hand-curated, not learned (docs/product.md O3): the five-ish things most
 * runners in each band actually reach for, as generic (no product link)
 * placeholders — the whole point of D-27's upgrade path.
 */
import type { Garment } from "../../lib/contracts";

export const climateBands = ["cold", "mild", "hot"] as const;
export type ClimateBand = (typeof climateBands)[number];

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
 * Every entry carries a `type`, because the tap-list is the one place we
 * always know it — the row *is* the type. That is what lets onboarding draw
 * a glyph per row without a lookup table (`<Icon name={garment.type}>`).
 *
 * The key is not the type and must not be treated as one: `mild-long-sleeve`
 * is a quarter-zip, so it is `halfZip`. Deriving the glyph from the key
 * would have been wrong on the first row that tried it.
 */
export const TAP_LISTS: Record<ClimateBand, readonly TapListEntry[]> = {
  cold: [
    entry("cold-base-top", {
      category: "top",
      type: "longSleeve",
      name: "Long sleeve base layer",
      layer: "base",
      weight: "mid",
    }),
    entry("cold-outer-top", {
      category: "top",
      type: "jacket",
      name: "Wind jacket",
      layer: "outer",
      weight: "light",
      windResistant: true,
    }),
    entry("cold-tights", {
      category: "bottom",
      type: "tights",
      name: "Running tights",
      layer: "base",
      weight: "mid",
    }),
    entry("cold-gloves", {
      category: "gloves",
      type: "gloves",
      name: "Running gloves",
      weight: "mid",
    }),
    entry("cold-beanie", {
      category: "headwear",
      type: "beanie",
      name: "Beanie",
      weight: "mid",
    }),
  ],
  mild: [
    entry("mild-tee", {
      category: "top",
      type: "tee",
      name: "Short sleeve tee",
      layer: "base",
      weight: "light",
    }),
    entry("mild-long-sleeve", {
      category: "top",
      type: "halfZip",
      name: "Long sleeve quarter-zip",
      layer: "mid",
      weight: "mid",
    }),
    entry("mild-shorts", {
      category: "bottom",
      type: "shorts",
      name: "Running shorts",
      layer: "base",
      weight: "light",
    }),
    entry("mild-socks", {
      category: "socks",
      type: "socks",
      name: "Running socks",
      weight: "mid",
    }),
    entry("mild-cap", {
      category: "headwear",
      type: "cap",
      name: "Running cap",
      weight: "light",
    }),
  ],
  hot: [
    entry("hot-singlet", {
      category: "top",
      type: "singlet",
      name: "Singlet",
      layer: "base",
      weight: "light",
    }),
    entry("hot-shorts", {
      category: "bottom",
      type: "shorts",
      name: "Split shorts",
      layer: "base",
      weight: "light",
    }),
    entry("hot-socks", {
      category: "socks",
      type: "socks",
      name: "No-show socks",
      weight: "light",
    }),
    entry("hot-cap", {
      category: "headwear",
      type: "cap",
      name: "Running cap",
      weight: "light",
    }),
    entry("hot-sunglasses", {
      category: "accessory",
      type: "sunglasses",
      name: "Running sunglasses",
    }),
  ],
};
