/**
 * Weather — one section of the shared contracts, re-exported whole by
 * `../contracts.ts`. Import from there, not from here.
 */
import { z } from "zod";

import { isTimeZone } from "../dates";

// ---- Weather --------------------------------------------------------------

export const weatherObservationSchema = z.object({
  tempC: z.number(),
  feelsLikeC: z.number(),
  humidity: z.number().min(0).max(100),
  windKph: z.number().min(0),
  precipMm: z.number().min(0),
  condition: z.string(),
  /**
   * The IANA zone of the place observed, as the provider names it (R-96).
   *
   * Optional, and additive: a manual observation has none, and neither
   * does anything cached before the column existed. Refined rather than
   * any string, because an invalid zone does not fail here — it throws
   * inside `Intl` at render time, on every screen that shows the run.
   */
  timeZone: z.string().refine(isTimeZone).optional(),
});
export type WeatherObservation = z.infer<typeof weatherObservationSchema>;

/**
 * R2b's second pick (design round 26, item 2): the sky a runner says they
 * ran under, when the weather gave up on a run. Stored beside the band in
 * `manual_conditions.sky`, in the order the sheet offers them, driest
 * first. Like the band, it is excluded from every aggregate.
 */
export const manualSkies = ["dry", "damp", "rain", "snow"] as const;
export const manualSkySchema = z.enum(manualSkies);
export type ManualSky = z.infer<typeof manualSkySchema>;

/**
 * What a place is like in a season, rather than on a day.
 *
 * Means over the provider's statistical period, not a single reading: a
 * mild January 15th in Minneapolis is weather, and choosing a starter
 * wardrobe from it would be choosing from noise.
 */
export interface ClimateNormals {
  /**
  Mean daily low across the coldest part of the year, °C.
  */
  winterLowC: number;
  /**
  Mean daily high across the warmest part of the year, °C.
  */
  summerHighC: number;
}

/**
 * Where a runner runs, as O1 leaves it: coordinates when the browser was
 * allowed to say, otherwise the label they typed. Either is enough for
 * the provider to find the place (R-59) — a typed "Omaha, NE" resolves
 * upstream, so refusing geolocation no longer costs the starter list its
 * ordering. Never both: coordinates are the better answer when present.
 */
export type ClimatePlace =
  | { kind: "coordinates"; lat: number; lng: number }
  | { kind: "label"; label: string };

export interface WeatherProvider {
  /**
  Historical/near-past conditions at a time+place (for imports).
  */
  observation(lat: number, lng: number, at: Date): Promise<WeatherObservation>;
  /**
  Seasonal normals at a place, for choosing a starter wardrobe (O3).
  */
  climateNormals(place: ClimatePlace): Promise<ClimateNormals>;
  /**
  Forecast at a future time+place (for the call, post-MVP).
  */
  forecast(lat: number, lng: number, at: Date): Promise<WeatherObservation>;
  /**
  Where a typed place is, or nothing when the provider cannot find it —
  E2-lite's typed city, after the runner refused their location.
  */
  resolvePlace(label: string): Promise<ResolvedPlace | undefined>;
}

/**
 * Where the provider found a typed place, and what it calls it. `address`
 * is the provider's name for the place ("Portland, OR, United States"),
 * not the runner's text: a bare "Portland" has more than one answer, and
 * this is the one that was picked (PR #102 review).
 */
export interface ResolvedPlace {
  lat: number;
  lng: number;
  address: string;
}
