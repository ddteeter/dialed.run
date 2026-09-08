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
 * No entry carries a `type`, and the row label is not one.
 *
 * The first version set one per row, on the reasoning that a tap-list row
 * *is* a type. Design's Z screen says otherwise and is right: type is a
 * property of the **product**, written on match or by enrichment, and a
 * tap-list save creates a generic garment with no product. "Long sleeve
 * base layer" is a label for a thing to tap, the same way "Green L/S Crew"
 * is a name someone typed — reading either as a type is the parser design
 * rules out, which "fails invisibly and can't be corrected by the person
 * looking at the wrong answer".
 *
 * These pieces gain a type the moment the runner names one (P2.5), which
 * is the second thing naming buys and the one they can see immediately —
 * the piece appears in a filter it was invisible to a moment ago.
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
