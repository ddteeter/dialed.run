import type { CallConditions } from "../contract";

type Forecast = Extract<CallConditions, { kind: "forecast" }>;

/**
 * The forecast fields `score` reads, and the only ones (owner, 2026-11-26,
 * #1105): the feel, which gives the band and is held against estimates,
 * and the rain, which gives the condition class. It does not read the air
 * temperature or the wind.
 *
 * The replay harness's release check takes this as the scorer's
 * declaration. A case rebuilt from a past run carries no real temperature
 * or wind, so a version that adds either here cannot be released on
 * rebuilt cases alone, and one that reads a field without adding it here
 * is caught by the harness's probe.
 */
export const SCORER_READS = [
  "feelsLikeC",
  "precipMm",
] as const satisfies readonly Exclude<keyof Forecast, "kind">[];

/**
 * A forecast as the scorer may see it: the declared fields and no others.
 * `score` takes its forecast through this type, so reading a field that
 * is not declared above does not compile.
 */
export type ForecastRead = Pick<Forecast, (typeof SCORER_READS)[number]>;
