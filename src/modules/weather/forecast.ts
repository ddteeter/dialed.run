/**
 * Forecast pass-through (post-MVP call epic consumes this; built now per
 * the packet). Same cache as `attach.ts` — a forecast fetched for an hour
 * that a later run lands in is reused rather than re-fetched.
 */
import type { WeatherObservation } from "../../lib/contracts";
import { weatherProvider } from "./provider";
import {
  cacheKeyFor,
  findObservationRow,
  toWeatherObservation,
  upsertRealObservation,
} from "./store";

/**
 * Public API: forecast conditions at a future time+place. Not tied to any
 * run — `run_id` is informational only, so cache writes leave it unset.
 */
export async function forecast(
  lat: number,
  lng: number,
  at: Date,
): Promise<WeatherObservation> {
  const key = cacheKeyFor(lat, lng, at);
  const cached = await findObservationRow(key);
  if (cached) {
    return toWeatherObservation(cached);
  }
  const provider = weatherProvider();
  const observation = await provider.forecast(lat, lng, at);
  const row = await upsertRealObservation(key, observation, undefined);
  return toWeatherObservation(row);
}
