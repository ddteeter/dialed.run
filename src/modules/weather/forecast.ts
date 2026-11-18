/**
 * Forecast pass-through (post-MVP call epic consumes this; built now per
 * the packet). Same cache as `attach.ts` — a forecast fetched for an hour
 * that a later run lands in is reused rather than re-fetched.
 */
import type { WeatherObservation } from "../../lib/contracts";
import { spendNothing } from "./budget";
import type { SpendWeatherCall } from "./budget";
import { weatherProvider } from "./provider";
import {
  cacheKeyFor,
  findObservationRow,
  toWeatherObservation,
  upsertRealObservation,
} from "./store";

/**
 * Public API: forecast conditions at a future time+place. Not tied to any
 * run, as no cache row is. A call that reaches the provider is `spend`'s
 * to count first (`./budget`); a cached hour costs nothing.
 */
export async function forecast(
  lat: number,
  lng: number,
  at: Date,
  spend: SpendWeatherCall = spendNothing,
): Promise<WeatherObservation> {
  const key = cacheKeyFor(lat, lng, at);
  const cached = await findObservationRow(key);
  if (cached) {
    return toWeatherObservation(cached);
  }
  await spend();
  const provider = weatherProvider();
  const observation = await provider.forecast(lat, lng, at);
  const row = await upsertRealObservation(key, observation);
  return toWeatherObservation(row);
}
