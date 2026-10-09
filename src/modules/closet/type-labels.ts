import { garmentCategoryLabels } from "../../lib/contracts";
import type { garmentCategories } from "../../lib/contracts";
import {
  garmentTypesFor,
  type GarmentType,
} from "../../lib/contracts/garment-fields";

/**
 * Each garment type as F's TYPE chips name it (round 26 #10, D-75).
 *
 * **The keys are the contract's**: `satisfies` holds them to
 * `garmentTypesByCategory`, so a type added there stops this compiling
 * until it has a name. The words are display copy that exists nowhere
 * else, the same split `garmentCategoryLabels` and `COLOR_LABELS` make.
 *
 * Round 26 draws four of them, for tops: "Singlet", "Tee", "L/S crew",
 * "Half-zip". The rest are the plain name of the pack's glyph, a build
 * reading recorded in `docs/design-deltas.md` for design to confirm.
 */
export const garmentTypeLabels = {
  singlet: "Singlet",
  tee: "Tee",
  longSleeve: "L/S crew",
  halfZip: "Half-zip",
  jacket: "Jacket",
  vest: "Vest",
  sportsBra: "Sports bra",
  shorts: "Shorts",
  halfTights: "Half tights",
  tights: "Tights",
  cap: "Cap",
  beanie: "Beanie",
  headband: "Headband",
  neckGaiter: "Neck gaiter",
  gloves: "Gloves",
  socks: "Socks",
  shoes: "Shoes",
  sunglasses: "Sunglasses",
  armSleeves: "Arm sleeves",
} as const satisfies Record<GarmentType, string>;

/**
 * Each type in the plural the rail's empty line reads in — round 26's
 * "No half-zips yet." Written out, because English plurals are not a
 * suffix ("half tights", "shorts", "gloves" are already plural).
 */
export const garmentTypePlurals = {
  singlet: "singlets",
  tee: "tees",
  longSleeve: "L/S crews",
  halfZip: "half-zips",
  jacket: "jackets",
  vest: "vests",
  sportsBra: "sports bras",
  shorts: "shorts",
  halfTights: "half tights",
  tights: "tights",
  cap: "caps",
  beanie: "beanies",
  headband: "headbands",
  neckGaiter: "neck gaiters",
  gloves: "gloves",
  socks: "socks",
  shoes: "shoes",
  sunglasses: "sunglasses",
  armSleeves: "arm sleeves",
} as const satisfies Record<GarmentType, string>;

/**
 * What kind of piece it is, as F names it: the category, then the type
 * when there is one — round 26's "TOP · HALF-ZIP", on the rail's title
 * and on `SAVED TO CLOSET`. Mono supplies the capitals.
 */
export function kindLabel(
  category: (typeof garmentCategories)[number],
  type: GarmentType | undefined,
): string {
  const named = garmentCategoryLabels[category];
  return type === undefined ? named : `${named} · ${garmentTypeLabels[type]}`;
}

/**
 * A stored or typed type as one of the category's, or nothing when it is
 * none of them (or none at all). The form and the `type` column hold a
 * string; this is where it becomes a contract type again, without a cast.
 */
export function typeOf(
  category: (typeof garmentCategories)[number],
  value: string | null,
): GarmentType | undefined {
  return garmentTypesFor(category).find((type) => type === value);
}
