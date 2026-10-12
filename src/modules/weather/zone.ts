/**
 * The IANA zone a place is in (design 142), for the profile's cached zone.
 *
 * **Not a second way to call Visual Crossing.** It is `forecast` for this
 * moment, read for its zone: the same adapter, under the same
 * `AbortSignal.timeout`, through the same zod parse and `isTimeZone` check,
 * and through the same observation cache, so a place someone already
 * looked up this hour costs no request at all. The zone is the one at the
 * Timeline response's root (R-96), which a one-record `include=current`
 * read already carries.
 *
 * Throws what `forecast` throws: an unavailable provider is the caller's
 * to degrade from. `undefined` when the provider answered without a zone
 * `Intl` accepts.
 */
import { forecast } from "./forecast";

export async function timeZoneAt(
  lat: number,
  lng: number,
): Promise<string | undefined> {
  const now = await forecast(lat, lng, new Date());
  return now.timeZone;
}
