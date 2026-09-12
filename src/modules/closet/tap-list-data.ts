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
  Stable key — what the onboarding UI sends back.
  */
  key: string;
  garment: Garment;
  /**
  Position per band, lowest first. Every band ranks every row.
  */
  rank: Record<ClimateBand, number>;
}

function entry(
  key: string,
  garment: Garment,
  rank: Record<ClimateBand, number>,
): TapListEntry {
  return { key, garment, rank };
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
/**
 * The one canonical list (design round 6, `Remaining Screens.dc.html` §AA).
 *
 * **The band orders this list and sets where it folds. It never removes a
 * row.** Three disjoint per-band lists is what this used to be, and the
 * argument against it is one sentence from the artboard: *a Minneapolis
 * runner owns tights and a singlet*. One band per person is a season, not
 * a wardrobe — so a January row and a July row sit in the same list, and
 * mittens fall behind the fold in Phoenix rather than out of existence.
 *
 * `rank` is the position per band, lowest first. Ranks are per-band
 * *orderings* rather than scores, so every band ranks every row.
 *
 * **Design named the 14 rows above the fold and specified 24 in total.**
 * The 18 here are those 14 plus the four distinct rows the previous
 * per-band lists carried that the artboard does not name. The remaining
 * six are unspecified content, not unspecified structure — see
 * `docs/deferred.md` D-49. The fold works at any length; the disclosure
 * states the real remainder.
 */
export const TAP_LIST: readonly TapListEntry[] = [
  entry("tights", { category: "bottom", name: "Running tights", layer: "base", weight: "mid" }, { cold: 1, mild: 9, hot: 17 }),
  entry("merino-base", { category: "top", name: "Merino base layer", layer: "base", weight: "mid" }, { cold: 2, mild: 10, hot: 18 }),
  entry("beanie", { category: "headwear", name: "Beanie", weight: "mid" }, { cold: 3, mild: 12, hot: 16 }),
  entry("gloves", { category: "gloves", name: "Running gloves", weight: "mid" }, { cold: 4, mild: 11, hot: 15 }),
  entry("mittens", { category: "gloves", name: "Mittens", weight: "heavy" }, { cold: 5, mild: 15, hot: 19 }),
  entry("wind-shell", { category: "top", name: "Wind shell", layer: "outer", weight: "light", windResistant: true }, { cold: 6, mild: 5, hot: 13 }),
  entry("vest", { category: "top", name: "Running vest", layer: "mid", weight: "light", windResistant: true }, { cold: 7, mild: 6, hot: 14 }),
  entry("buff", { category: "neckwear", name: "Buff", weight: "light" }, { cold: 8, mild: 13, hot: 12 }),
  entry("shorts-7", { category: "bottom", name: '7" shorts', layer: "base", weight: "light" }, { cold: 9, mild: 2, hot: 3 }),
  entry("tee", { category: "top", name: "Short sleeve tee", layer: "base", weight: "light" }, { cold: 10, mild: 1, hot: 2 }),
  entry("arm-warmers", { category: "accessory", name: "Arm warmers" }, { cold: 11, mild: 8, hot: 11 }),
  entry("rain-jacket", { category: "top", name: "Rain jacket", layer: "outer", weight: "light", waterResistant: true }, { cold: 12, mild: 7, hot: 10 }),
  entry("shorts-5", { category: "bottom", name: '5" shorts', layer: "base", weight: "light" }, { cold: 13, mild: 3, hot: 1 }),
  entry("singlet", { category: "top", name: "Singlet", layer: "base", weight: "light" }, { cold: 14, mild: 4, hot: 4 }),
  entry("quarter-zip", { category: "top", name: "Long sleeve quarter-zip", layer: "mid", weight: "mid" }, { cold: 15, mild: 14, hot: 20 }),
  entry("socks", { category: "socks", name: "Running socks", weight: "mid" }, { cold: 16, mild: 16, hot: 6 }),
  entry("cap", { category: "headwear", name: "Running cap", weight: "light" }, { cold: 17, mild: 17, hot: 5 }),
  entry("sunglasses", { category: "accessory", name: "Sunglasses" }, { cold: 18, mild: 18, hot: 7 }),
];

/**
 * Where the list folds. The rows past it are one tap behind a disclosure
 * that states its own remainder — never absent.
 */
export const TAP_LIST_FOLD = 14;
