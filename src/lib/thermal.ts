import type { z } from "zod";

import type { garmentSchema, layerSchema, weightSchema } from "./contracts";

type Category = z.infer<typeof garmentSchema>["category"];
type Layer = z.infer<typeof layerSchema>;
type Weight = z.infer<typeof weightSchema>;

export interface TempRange {
  /**
  Absent when nothing warmer exists to switch into.
  */
  lowC?: number;
  /**
  Absent when nothing lighter exists to switch into.
  */
  highC?: number;
}

/**
Fahrenheit -> Celsius, for the tables below only.
*/
function f(lowF: number, highF: number): TempRange {
  return {
    lowC: Math.round(((lowF - 32) * 5) / 9),
    highC: Math.round(((highF - 32) * 5) / 9),
  };
}

/**
 * Hand-built thermal defaults (docs/tasks/101 §3): the attribute-derived
 * guess per category × weight, with outer-layer variants for top/bottom.
 * The future call epic replaces these with learned per-user bands;
 * `fabric_composition` is deliberately unused here (noted in the packet).
 *
 * **Written in Fahrenheit, stored in Celsius.** Every value that leaves
 * this file is °C — the contract fields, the DB columns and the 5°C band
 * arithmetic are all Celsius, and mixing units in the data is how you get
 * a class of bug that is very hard to see. But these ~30 numbers are a
 * human judgement about how warm a mid-weight merino top feels, and they
 * are reviewed by a US-based owner who can tell at a glance that 55-70°F
 * is wrong and cannot do the same for 13-21°C. So the literals are the
 * ones a reviewer can judge, and `f()` converts once at module load.
 */
const BODY_RANGES: Record<"regular" | "outer", Record<Weight, TempRange>> = {
  regular: {
    light: f(55, 79),
    mid: f(39, 59),
    heavy: f(19, 46),
  },
  outer: {
    light: f(43, 61),
    mid: f(25, 50),
    heavy: f(0, 36),
  },
};

const BOTTOM_RANGES: Record<"regular" | "outer", Record<Weight, TempRange>> = {
  regular: {
    light: f(50, 86),
    mid: f(28, 54),
    heavy: f(5, 39),
  },
  outer: {
    light: f(36, 54),
    mid: f(18, 43),
    heavy: f(-4, 32),
  },
};

const ACCESSORY_RANGES: Partial<Record<Category, Record<Weight, TempRange>>> = {
  headwear: {
    light: f(39, 57),
    mid: f(21, 43),
    heavy: f(-4, 28),
  },
  neckwear: {
    light: f(32, 50),
    mid: f(14, 39),
    heavy: f(-8, 25),
  },
  gloves: {
    light: f(36, 54),
    mid: f(18, 41),
    heavy: f(-8, 23),
  },
  socks: {
    light: f(46, 86),
    mid: f(25, 54),
    heavy: f(0, 39),
  },
};

/**
Wind-resistant fabric blocks chill: the band extends downward.
*/
const WIND_LOW_EXTENSION_C = 3;

export interface ThermalInput {
  category: Category;
  layer?: Layer | undefined;
  weight?: Weight | undefined;
  windResistant?: boolean | undefined;
}

/**
 * The attribute-derived temp band, or undefined when the attributes cannot
 * support a guess (no weight; shoes/accessories carry no thermal signal).
 */
/**
 * Categories you always wear one of. There is no lighter option than a
 * light top — you are still wearing a top at 95°F — so the lightest weight
 * in these has no upper bound. An optional layer is different: above its
 * range you take the jacket off, and "no jacket" is a real choice.
 */
const ALWAYS_WORN: ReadonlySet<Category> = new Set<Category>([
  "top",
  "bottom",
  "socks",
  "shoes",
]);

/**
 * The attribute-derived temp band, or undefined when the attributes cannot
 * support a guess (no weight; shoes/accessories carry no thermal signal).
 *
 * **Open-ended at the ends of the scale**, because a bound means "past
 * here, switch to something else" and at the extremes there is nothing to
 * switch to:
 *
 * - the lightest weight of a category you always wear one of has no upper
 *   bound — above a light top's old 79°F ceiling, the answer was still a
 *   light top;
 * - the heaviest *outer* layer has no lower bound, since nothing goes over
 *   it. A heavy base layer keeps its lower bound, because the answer below
 *   it is to add an outer layer rather than a warmer base.
 *
 * Only the middle of the scale is genuinely bounded both ways.
 */
export function estimateTempRange(input: ThermalInput): TempRange | undefined {
  if (input.weight === undefined) return undefined;
  const isOuter = input.layer === "outer";
  let range: TempRange | undefined;
  if (input.category === "top" || input.category === "bottom") {
    const table = input.category === "top" ? BODY_RANGES : BOTTOM_RANGES;
    range = table[isOuter ? "outer" : "regular"][input.weight];
  } else {
    range = ACCESSORY_RANGES[input.category]?.[input.weight];
  }
  if (range === undefined) return undefined;

  const hasOpenHigh =
    input.weight === "light" && !isOuter && ALWAYS_WORN.has(input.category);
  const hasOpenLow = isOuter && input.weight === "heavy";

  const baseLow = range.lowC;
  const lowC =
    baseLow !== undefined && input.windResistant
      ? baseLow - WIND_LOW_EXTENSION_C
      : baseLow;
  return {
    ...(!hasOpenLow && { lowC }),
    ...(!hasOpenHigh && { highC: range.highC }),
  };
}

/**
 * The band as a user reads it. Open ends render as a direction rather than
 * a number, because "55–79°" claims a light top stops working at 80° and
 * it does not — there is nothing lighter to change into.
 */
export function formatTempRange(range: TempRange): string | undefined {
  const low = range.lowC === undefined ? undefined : Math.round(range.lowC);
  const high = range.highC === undefined ? undefined : Math.round(range.highC);
  if (low !== undefined && high !== undefined) return `${String(low)}–${String(high)}°`;
  if (low !== undefined) return `${String(low)}°+`;
  if (high !== undefined) return `under ${String(high)}°`;
  return undefined;
}
