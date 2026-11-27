import { z } from "zod";

import { roundCoordinate } from "../coords";
import { latitudeSchema, longitudeSchema } from "./garments";
import type { ResolvedPlace } from "./weather";

/**
 * The typed city's contract (round 26 #12), shared by the field that asks
 * (`ui/CityFinder`, on O1 and on Your conditions) and the server function
 * that answers (onboarding's `lookUpCityFn`). In `lib/` because `ui/`
 * imports `lib/` and never a module.
 */

/**
 * What Find came to. Three answers, because the field does three different
 * things with them:
 *
 * - `found` — "Weather for {address}", with Use this, and the stamp that
 *   Use this hands back so the place is saved as the provider named it;
 * - `not-found` — a field message: the fix is in the field;
 * - `unavailable` — the lookup itself failed, the `NOT FOUND YET` band.
 */
export type CityLookup =
  | ({ kind: "found"; stamp: string } & ResolvedPlace)
  | { kind: "not-found" }
  | { kind: "unavailable" };

/**
What Use this is handed: the place Find found, with its stamp.
*/
export type FoundPlace = Extract<CityLookup, { kind: "found" }>;

/**
 * What Find sends, and the one field message it can fail with before it
 * asks. Error copy lives in the schema (§Forms & failure), so the field
 * and the server read the same sentence.
 */
export const cityLookupInput = z.object({
  label: z
    .string()
    .trim()
    .min(1, { message: "Type the city you run in." })
    .max(120),
});

/**
 * The field message for a place the provider cannot find, quoting what
 * was typed so the runner can see the typo.
 */
export function cityNotFound(label: string): string {
  return `We couldn't find "${label}". Check the spelling, or try a nearby city.`;
}

/**
 * A profile's coordinates, rounded as they are parsed (task 127, STR-14;
 * R-110): the fallback point is often home, and nothing needs more than
 * `lib/coords`' two places. Rounding here, at the boundary both writers of
 * the place parse through (O1's calibration and Your conditions' Use
 * this), means `onboarding/profile.ts` stores what it is given and an
 * absent coordinate never reaches the rounding at all.
 */
export const profileLatitude = latitudeSchema.transform(roundCoordinate);
export const profileLongitude = longitudeSchema.transform(roundCoordinate);

/**
 * Find's stamp on a place, as Use this hands it back: hex, bounded, and
 * checked by the place writers rather than here.
 */
export const placeStampSchema = z.string().max(64);

/**
 * A place the runner found and pressed Use this on: the provider's name
 * for it and where it is (round 26 #12). What the one writer of the
 * profile's place takes (FEED-5), from O1 and from Your conditions alike.
 */
export const placeInput = z.object({
  cityLabel: z.string().trim().min(1).max(200),
  lat: profileLatitude,
  lng: profileLongitude,
  stamp: placeStampSchema,
});
export type Place = z.infer<typeof placeInput>;
