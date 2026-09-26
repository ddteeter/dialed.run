/**
 * The rules for a run's conditions that a screen needs as much as the
 * server does — so they live in a sibling that imports nothing
 * server-side, the `not-found.ts` shape.
 *
 * **Weather is never typed by a human.** Round 22 retired the manual
 * temperature form for one row — *"No conditions · Set conditions ›"*,
 * opening R2b — and ruled that *"the runner picks from what R2b offers and
 * never types a number; weather that arrived is never editable."* What R2b
 * offers is the app's own temperature bands: the 5 °C steps the verdict
 * history is already counted in, so a runner who sets a morning at "41–50°"
 * has said exactly as much as the band record can use, and nothing a
 * keyboard could get wrong.
 */

/**
 * The bands R2b offers, as the floor of each in °C: −20 °C to 40 °C, which
 * is every morning a runner is likely to be out in and says so in the
 * runner's own unit through `bandLabel`.
 */
export const SET_CONDITION_BANDS: readonly number[] = Array.from(
  { length: 12 },
  (_, index) => -20 + index * 5,
);

/**
 * The temperature a chosen band is stored as: its middle. Stored with
 * `source='manual'`, so it never reaches a consensus aggregate — it only
 * dates the run into a band and draws "55°F · SET BY YOU" in the list.
 */
export function bandMiddleC(bandFloorC: number): number {
  return bandFloorC + 2.5;
}

/**
 * A run whose conditions a runner may set, or ask for again: the weather
 * gave up on it (`failed`), and it has a place to key an observation on.
 * Weather that arrived — `attached`, or one already `manual` — is never
 * editable; a run still `pending` is still being asked about; an indoor
 * run has no weather at all.
 */
export function canSetConditions(run: {
  weatherStatus: string;
  lat: number | null;
  lng: number | null;
}): boolean {
  return run.weatherStatus === "failed" && run.lat !== null && run.lng !== null;
}
