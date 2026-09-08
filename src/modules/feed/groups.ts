/**
 * Closet UI groups, derived from category × layer (docs/contracts.md).
 * Duplicated by design with lane 101 — the predicate table is the shared
 * contract, the code is not.
 */

type GarmentCategory =
  | "top"
  | "bottom"
  | "headwear"
  | "neckwear"
  | "gloves"
  | "socks"
  | "shoes"
  | "accessory";
type GarmentLayer = "base" | "mid" | "outer" | null;

export const uiGroups = [
  "tops",
  "bottoms",
  "outer",
  "hands_head",
  "shoes",
  "socks_extras",
] as const;
export type UiGroup = (typeof uiGroups)[number];

export const uiGroupLabels: Record<UiGroup, string> = {
  tops: "Tops",
  bottoms: "Bottoms",
  outer: "Outer",
  hands_head: "Hands / head",
  shoes: "Shoes",
  socks_extras: "Socks / extras",
};

export function uiGroupFor(
  category: GarmentCategory,
  layer: GarmentLayer,
): UiGroup {
  if (layer === "outer") return "outer";
  switch (category) {
    case "top": {
      return "tops";
    }
    case "bottom": {
      return "bottoms";
    }
    case "headwear":
    case "neckwear":
    case "gloves": {
      return "hands_head";
    }
    case "shoes": {
      return "shoes";
    }
    case "socks":
    case "accessory": {
      return "socks_extras";
    }
  }
}
