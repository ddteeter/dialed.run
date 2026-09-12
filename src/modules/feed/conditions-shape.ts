/**
 * What a set of conditions *is*, with no way to read one.
 *
 * Separate from `conditions.ts` because that file imports `src/env` to
 * reach `DIALED_WEATHER`, and anything importing a value from it drags
 * `cloudflare:workers` along — which breaks the client build and, before
 * that, any test running in jsdom. The types alone would be fine (they
 * erase); `pointSpan` is a value, and a value is what pulls the graph.
 *
 * Same device as `feed/route-decisions.ts` and `runs/not-found.ts`:
 * the part a component or a dom test needs lives in a sibling that
 * imports nothing server-side, and `conditions.ts` re-exports it so
 * callers that are already server-side see one module.
 */
export interface Conditions {
  /**
   * The **starting** hour, still — every reader that had one number before
   * this lane keeps the same one. What a run is *judged* at is a separate
   * question with a separate answer: see `judgedFeelsLikeC`.
   */
  tempC: number;
  feelsLikeC: number;
  precipMm: number;
  condition: string;
  windKph: number;
  source: "visualcrossing" | "manual";
  /**
   * The coldest and warmest the run actually got, across every hour it
   * spanned. A run inside one hour has `min === max`, which is what makes
   * the range safe to render unconditionally.
   *
   * Precipitation and condition stay the starting hour's: a range of
   * `precipMm` is not a thing anyone judges an outfit by, and
   * `precipClassOf` wants one value.
   */
  span: ConditionsSpan;
}

export interface ConditionsSpan {
  minTempC: number;
  maxTempC: number;
  minFeelsLikeC: number;
  maxFeelsLikeC: number;
}

/**
A span with no width, for a reading that covers a single hour.
*/
export function pointSpan(tempC: number, feelsLikeC: number): ConditionsSpan {
  return {
    minTempC: tempC,
    maxTempC: tempC,
    minFeelsLikeC: feelsLikeC,
    maxFeelsLikeC: feelsLikeC,
  };
}
