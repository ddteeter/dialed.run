/**
 * How precisely a place is kept (task 127, STR-14; register D-110).
 *
 * **Two decimal places: about 1.1 km of latitude**, and less of longitude
 * away from the equator. That is the precision every weather lookup here
 * already works at — the `dialed-weather` cache keys a cell on
 * coordinates rounded to two places (docs/contracts.md) — so a finer point
 * buys no better conditions, while it does pin a run's start to a front
 * door. A start point is often home, and a public entry's run is visible
 * to strangers; a kilometre is a neighbourhood.
 *
 * So a coordinate is rounded **before it is stored and before it is sent**
 * to Visual Crossing: a stored run's point is what the provider is asked
 * for, so rounding where runs are written covers both. The profile's
 * fallback point uses the same helper where it is written (task 129,
 * FEED-5). Rounding an already-rounded value changes nothing, which is why
 * the weather cache key still hits.
 */
export function roundCoordinate(value: number): number {
  return Math.round(value * 100) / 100;
}
