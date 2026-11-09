/**
 * What a set of conditions *is*, with no way to read one: the shape the
 * weather module derives for a run and the feed renders (design 189 moved
 * it here from `feed/conditions-shape.ts` so weather can build it too).
 *
 * Pure and isomorphic, like the rest of `lib/contracts`: a component may
 * import it, which is why it never lived beside the reads that need
 * `src/env`.
 */
import { precipClassOf } from "./temperature";

/**
Where a run's conditions came from: the weather provider, or a band its runner set (B1).
*/
export const CONDITIONS_SOURCES = ["visualcrossing", "manual"] as const;
export type ConditionsSource = (typeof CONDITIONS_SOURCES)[number];

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
  source: ConditionsSource;
  /**
   * The IANA zone of the place the observation was made (R-96), so a run's
   * date and time render where the run happened rather than in UTC.
   * Absent for manual conditions and for anything cached before the zone
   * was stored; the date formatters fall back to UTC then.
   */
  timeZone?: string | undefined;
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
 * Weather's half of a run's copy in core (`run_conditions`, D-175), as the
 * run's conditions give it: the start, the coldest and warmest hours, the
 * starting hour's precipitation class and where it came from. Pure, so a
 * seed that writes the copy directly builds it the way the writer does.
 */
export function weatherHalfOf(conditions: Conditions) {
  return {
    feelsLikeC: conditions.feelsLikeC,
    minFeelsLikeC: conditions.span.minFeelsLikeC,
    maxFeelsLikeC: conditions.span.maxFeelsLikeC,
    precipClass: precipClassOf(conditions.precipMm),
    source: conditions.source,
  };
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
