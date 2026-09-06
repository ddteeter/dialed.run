import type { z } from "zod";

import type { garmentSchema, layerSchema, weightSchema } from "./contracts";

type Category = z.infer<typeof garmentSchema>["category"];
type Layer = z.infer<typeof layerSchema>;
type Weight = z.infer<typeof weightSchema>;

export interface TempRange {
  lowC: number;
  highC: number;
}

/**
 * Hand-built thermal defaults (docs/tasks/101 §3): the attribute-derived
 * guess per category × weight, with outer-layer variants for top/bottom.
 * Values are feels-like °C for a steady run; the future call epic replaces
 * these with learned per-user bands. `fabric_composition` is deliberately
 * unused here (noted for the call epic in the packet).
 */
const BODY_RANGES: Record<"regular" | "outer", Record<Weight, TempRange>> = {
  regular: {
    light: { lowC: 13, highC: 26 },
    mid: { lowC: 4, highC: 15 },
    heavy: { lowC: -7, highC: 8 },
  },
  outer: {
    light: { lowC: 6, highC: 16 },
    mid: { lowC: -4, highC: 10 },
    heavy: { lowC: -18, highC: 2 },
  },
};

const BOTTOM_RANGES: Record<"regular" | "outer", Record<Weight, TempRange>> = {
  regular: {
    light: { lowC: 10, highC: 30 },
    mid: { lowC: -2, highC: 12 },
    heavy: { lowC: -15, highC: 4 },
  },
  outer: {
    light: { lowC: 2, highC: 12 },
    mid: { lowC: -8, highC: 6 },
    heavy: { lowC: -20, highC: 0 },
  },
};

const ACCESSORY_RANGES: Partial<Record<Category, Record<Weight, TempRange>>> = {
  headwear: {
    light: { lowC: 4, highC: 14 },
    mid: { lowC: -6, highC: 6 },
    heavy: { lowC: -20, highC: -2 },
  },
  neckwear: {
    light: { lowC: 0, highC: 10 },
    mid: { lowC: -10, highC: 4 },
    heavy: { lowC: -22, highC: -4 },
  },
  gloves: {
    light: { lowC: 2, highC: 12 },
    mid: { lowC: -8, highC: 5 },
    heavy: { lowC: -22, highC: -5 },
  },
  socks: {
    light: { lowC: 8, highC: 30 },
    mid: { lowC: -4, highC: 12 },
    heavy: { lowC: -18, highC: 4 },
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
export function estimateTempRange(input: ThermalInput): TempRange | undefined {
  if (input.weight === undefined) return undefined;
  let range: TempRange | undefined;
  if (input.category === "top" || input.category === "bottom") {
    const table = input.category === "top" ? BODY_RANGES : BOTTOM_RANGES;
    range = table[input.layer === "outer" ? "outer" : "regular"][input.weight];
  } else {
    range = ACCESSORY_RANGES[input.category]?.[input.weight];
  }
  if (range === undefined) return undefined;
  const lowC = input.windResistant
    ? range.lowC - WIND_LOW_EXTENSION_C
    : range.lowC;
  return { lowC, highC: range.highC };
}
