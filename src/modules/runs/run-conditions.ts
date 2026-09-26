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
import { z } from "zod";

import { manualSkies } from "../../lib/contracts";
import type { ManualSky, TempUnit } from "../../lib/contracts";
import { bandLabel } from "../../lib/temperature";

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
 * dates the run into a band.
 */
export function bandMiddleC(bandFloorC: number): number {
  return bandFloorC + BAND_HALF_WIDTH_C;
}

/**
 * The band a stored middle came from — so a set run reads back as the
 * range the runner picked, "41–50°", and never as the midpoint (round 26,
 * item 2: *"Showing 45.5° would claim a precision nobody measured"*).
 */
export function bandFloorOf(storedC: number): number {
  return storedC - BAND_HALF_WIDTH_C;
}

const BAND_HALF_WIDTH_C = 2.5;

/**
 * R2b's pick as the sheet holds it (round 26, item 2): two required
 * choices and nothing preselected. A radio's value is text, so the band
 * arrives as the string of its floor and leaves as the number; anything
 * that is not one of the bands, including no pick at all, is refused with
 * the sentence the board draws for it.
 */
export const conditionsPickSchema = z.object({
  bandFloorC: z
    .string()
    .refine((value) => BAND_OPTIONS.includes(value), {
      message: "Pick how warm it was.",
    })
    .transform(Number),
  sky: z.enum(manualSkies, { error: "Pick the sky." }),
});

/**
 * The sky's words, the four E2-lite uses (round 26, item 2). Typed over the
 * enum, so a fifth sky cannot be added without a word for it.
 */
export const SKY_WORDS: Readonly<Record<ManualSky, string>> = {
  dry: "Dry",
  damp: "Damp",
  rain: "Rain",
  snow: "Snow",
};

/**
 * A band the runner set, as every screen reads it back: the range in their
 * unit, never the stored middle — "41–50°".
 */
export function setBandLabel(storedC: number, unit: TempUnit): string {
  return bandLabel(bandFloorOf(storedC), unit);
}

/**
 * The bands as the sheet's radios carry them, coldest first.
 */
export const BAND_OPTIONS: readonly string[] = SET_CONDITION_BANDS.map(String);

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
