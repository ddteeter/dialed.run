import { climateBandSchema } from "../closet";
import type { ClimateBand } from "../closet";

/**
 * Which starter list a person sees, from where they run.
 *
 * **Latitude alone, deliberately.** The packet allows "rough climate band
 * from latitude/typical temps", and latitude is the half that needs no
 * data source, no network call and no upkeep. The case it has to get right
 * is the one the packet names — Minneapolis gets mittens, Phoenix does not
 * — and the boundaries below are chosen so it does: Minneapolis sits at
 * 45.0 and Phoenix at 33.4.
 *
 * What it gets wrong, knowingly: a maritime climate at a cold latitude
 * (Reykjavík is milder than its 64° suggests) and altitude anywhere
 * (Denver is colder than its 39° suggests). Both are a *starter list*
 * being slightly off, which the user fixes by tapping — not a wrong
 * recommendation, which is what the call epic must not ship. Replace this
 * with real climate normals when there is a reason to, not before.
 *
 * `Math.abs` because the southern hemisphere is symmetric: Wellington at
 * −41 is the same band as Toronto at +43.
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
