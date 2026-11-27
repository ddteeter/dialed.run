/**
 * The IANA zone a place is in (design 142), for the profile's cached zone.
 *
 * **Not a second way to call Visual Crossing.** It is the provider's
 * reading for this moment, read for its zone: the same adapter, under the
 * same `AbortSignal.timeout`, through the same zod parse and `isTimeZone`
 * check. The zone is the one at the Timeline response's root (R-96), which
 * a one-record `include=current` read already carries.
 *
 * **Uncached, and deliberately** (D-156). The hour being looked up is in
 * progress, so the provider can still be blending its reading from a
 * forecast. The observation cache is shared by every run in the cell that
 * hour and never refreshed, which is why `attach.ts` asks for an hour only
 * once it has settled. Writing this reading there would make it that
 * hour's weather for good. The cost is one request per lookup, counted
 * against `spend` first like any other (`./budget`).
 *
 * Throws what the provider throws: an unavailable provider is the caller's
 * to degrade from. `undefined` when the provider answered without a zone
 * `Intl` accepts.
 */
import { runnerWeatherBudget, spendNothing } from "./budget";
import type { SpendWeatherCall } from "./budget";
import { weatherProvider } from "./provider";

export async function timeZoneAt(
  lat: number,
  lng: number,
  spend: SpendWeatherCall = spendNothing,
): Promise<string | undefined> {
  await spend();
  const now = await weatherProvider().forecast(lat, lng, new Date());
  return now.timeZone;
}

/**
 * A runner's zone lookup, as their place save asks it, counted against
 * their day's budget when it reaches the provider (SA-M13).
 */
export function timeZoneAtFor(
  userId: string,
): (lat: number, lng: number) => Promise<string | undefined> {
  const spend = runnerWeatherBudget(userId);
  return (lat, lng) => timeZoneAt(lat, lng, spend);
}
