import type { fabricSchema, weightSchema } from "./contracts";

/**
 * Display names for the closet form's weight and fabric selects — "the
 * 104 select" — which WRONG?'s sheet offers too (R48·129c). The *values*
 * come from the schema's own enums, so an option can never exist that the
 * contract would reject (CLAUDE.md, "Derive, don't mirror").
 */
export const WEIGHT_LABELS: Readonly<
  Record<(typeof weightSchema.options)[number], string>
> = {
  light: "Light",
  mid: "Mid",
  heavy: "Heavy",
};

export const FABRIC_LABELS: Readonly<
  Record<(typeof fabricSchema.options)[number], string>
> = {
  synthetic: "Synthetic",
  merino: "Merino",
  cotton: "Cotton",
  blend: "Blend",
  down: "Down",
};

/**
 * Wind and water's answers (R48·129a).
 */
export const YES_NO_LABELS = { yes: "Yes", no: "No" } as const;
