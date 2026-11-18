/**
 * Seasonal normals pass-through, for choosing a starter wardrobe (O3).
 *
 * **Uncached, unlike every other read in this module, and deliberately.**
 * `weather_observations` is keyed `UNIQUE(lat_r, lng_r, hour_bucket)` — a
 * cache of *hours*, and normals are not an hour. Storing them there would
 * mean inventing a bucket that means "the statistical period", which is a
 * schema lie a later reader would have to unpick.
 *
 * The cost that cache exists to control is held another way: each read is
 * counted against the runner's day's budget (`./budget`, SA-M27), the
 * starter list asks only on a request the app's own page started, and
 * `resolveClimateBand` degrades to latitude when the provider is slow,
 * down or not asked (law 5). So the worst case is a starter list that is
 * plausible rather than right — not a blocked signup.
 */
import type { ClimateNormals, ClimatePlace } from "../../lib/contracts";
import type { SpendWeatherCall } from "./budget";
import { runnerWeatherBudget } from "./budget";
import { weatherProvider } from "./provider";

export async function climateNormals(
  place: ClimatePlace,
  spend: SpendWeatherCall,
): Promise<ClimateNormals> {
  await spend();
  return weatherProvider().climateNormals(place);
}

/**
A runner's normals read, counted against their day's budget (SA-M27).
*/
export function climateNormalsFor(
  userId: string,
): (place: ClimatePlace) => Promise<ClimateNormals> {
  const spend = runnerWeatherBudget(userId);
  return (place) => climateNormals(place, spend);
}
