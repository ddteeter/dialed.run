/**
 * Seasonal normals pass-through, for choosing a starter wardrobe (O3).
 *
 * **Uncached, unlike every other read in this module, and deliberately.**
 * `weather_observations` is keyed `UNIQUE(lat_r, lng_r, hour_bucket)` — a
 * cache of *hours*, and normals are not an hour. Storing them there would
 * mean inventing a bucket that means "the statistical period", which is a
 * schema lie a later reader would have to unpick.
 *
 * The cost that cache exists to control is not here either: normals are
 * read once per account, at onboarding, and `resolveClimateBand` degrades
 * to latitude when the provider is slow or down (law 5). So the worst case
 * is one extra record on the provider's bill and a starter list that is
 * plausible rather than right — not a blocked signup.
 */
import type { ClimateNormals } from "../../lib/contracts";
import { weatherProvider } from "./provider";

export function climateNormals(
  lat: number,
  lng: number,
): Promise<ClimateNormals> {
  return weatherProvider().climateNormals(lat, lng);
}
