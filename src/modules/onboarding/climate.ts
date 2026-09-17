import { climateBandSchema } from "../closet";
import type { ClimateBand } from "../closet";
import type { ClimateNormals } from "../../lib/contracts";

/**
 * The band from where a place sits on the globe — **the fallback, not the
 * plan.** `resolveClimateBand` below asks the weather provider for measured
 * normals first and lands here only when that call fails, because
 * onboarding must not block on a third party (resilience law 5). Latitude
 * is the half that needs no data source, no network call and no upkeep,
 * and it answers the packet's own worked example: Minneapolis (45.0) gets
 * mittens and Phoenix (33.4) does not.
 *
 * What it gets wrong is everything latitude cannot see, which is why it is
 * the fallback: a maritime climate at a cold latitude (Reykjavík is milder
 * than its 64° suggests) and altitude anywhere (Denver is colder than its
 * 39° suggests). Against measured normals it is wrong for four of the six
 * cities in the table below. Since round 6 the band only *orders* the
 * list, so a wrong band costs a scroll rather than a garment.
 *
 * It works on every continent in the one sense that matters: a parallel
 * is the same distance from the equator in Asia as in America, so the
 * heuristic is exactly as rough everywhere. `Math.abs` because the
 * southern hemisphere is symmetric — Wellington at −41 is the same band as
 * Toronto at +43.
 */
const COLD_FROM_DEGREES = 40;
const MILD_FROM_DEGREES = 30;

export function climateBandFor(lat: number): ClimateBand {
  const distanceFromEquator = Math.abs(lat);
  if (distanceFromEquator >= COLD_FROM_DEGREES) return "cold";
  if (distanceFromEquator >= MILD_FROM_DEGREES) return "mild";
  return "hot";
}

/**
 * The band for someone who would not share a location, or whose browser
 * refused.
 *
 * `mild` rather than a guess: a denied permission must not block
 * onboarding (requirement 1), and the mild list is the one whose mistakes
 * are smallest in both directions — offering mittens to Phoenix wastes a
 * tap, and withholding them from Minneapolis costs a garment the person
 * owns.
 */
export const BAND_WITHOUT_LOCATION: ClimateBand =
  climateBandSchema.parse("mild");

/**
 * The band from what a place is actually like, rather than from where it
 * sits on the globe.
 *
 * **Thresholds are set against measured normals, not chosen for roundness.**
 * Visual Crossing's `include=stats`, probed 2026-09-11 (Omaha 2026-09-16):
 *
 * | place       | winter mean low | summer mean high | band |
 * | ----------- | --------------: | ---------------: | ---- |
 * | Minneapolis |          −12.1  |            28.7  | cold |
 * | Denver      |           −8.0  |            31.0  | cold |
 * | Omaha       |           −7.7  |            31.3  | cold |
 * | Reykjavík   |           −2.8  |            14.0  | mild |
 * | Seattle     |            1.3  |            24.1  | mild |
 * | Phoenix     |            6.5  |            42.0  | hot  |
 *
 * `winterLowC <= -5` separates Denver from Reykjavík, which is the pair
 * that matters: both are "not Minneapolis", and only one needs mittens.
 * `summerHighC >= 32` separates Phoenix from Denver, whose 31.0 sits just
 * under it — deliberately, because Denver's winters are the thing its
 * wardrobe is built around.
 *
 * **A continental climate is not collapsed to one number.** `ClimateNormals`
 * carries both ends of the year on purpose: Omaha is −7.7 in January and
 * 31.3 in July, and averaging those would call it mild — the one answer
 * that is wrong for both halves of its year. The two questions are asked
 * in order, and **cold wins when a place is both**: −8 needs equipment,
 * while 31 needs a tee the runner already owns. The July rows are still in
 * the list — the band orders, it never removes — just behind the fold.
 */
const COLD_WINTER_LOW_C = -5;
const HOT_SUMMER_HIGH_C = 32;

export function bandFromNormals(normals: ClimateNormals): ClimateBand {
  if (normals.winterLowC <= COLD_WINTER_LOW_C) return "cold";
  if (normals.summerHighC >= HOT_SUMMER_HIGH_C) return "hot";
  return "mild";
}

/**
 * The band for a place, preferring what the weather says and falling back
 * to where the place is.
 *
 * The fallback is not decoration: onboarding must not block on a third
 * party (resilience law 5), and `climateBandFor` is wrong for four of the
 * five cities above — so a runner who hits a provider outage gets a
 * starter list that is plausible rather than right, and fixes it with a
 * tap. That is the correct trade, and the reason the latitude heuristic
 * stays rather than being deleted once normals landed.
 */
export async function resolveClimateBand(
  lat: number,
  lng: number,
  normalsFor: (lat: number, lng: number) => Promise<ClimateNormals>,
): Promise<ClimateBand> {
  try {
    return bandFromNormals(await normalsFor(lat, lng));
  } catch {
    return climateBandFor(lat);
  }
}
