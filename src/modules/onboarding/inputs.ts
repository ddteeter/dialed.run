import { z } from "zod";

import { roundCoordinate } from "../../lib/coords";
import { ulidSchema } from "../../lib/ids";

import {
  distanceUnitSchema,
  latitudeSchema,
  longitudeSchema,
  tempUnitSchema,
  thermalLevelSchema,
} from "../../lib/contracts";

/**
 * A profile's coordinates, rounded as they are parsed (task 127, STR-14;
 * D-110): the fallback point is often home, and nothing needs more than
 * `lib/coords`' two places. Rounding here, at the boundary both writers of
 * the place parse through (O1's calibration and Your conditions' Use
 * this), means `onboarding/profile.ts` stores what it is given and an
 * absent coordinate never reaches the rounding at all.
 */
const profileLatitude = latitudeSchema.transform(roundCoordinate);
const profileLongitude = longitudeSchema.transform(roundCoordinate);

/**
 * Next pressed with a city typed but never found (round 26 #12): the
 * field message says the two ways on. `calibrationInput` carries it, so
 * the server refuses an unconfirmed city as the form does.
 */
export const CITY_UNCONFIRMED = "Press Find, or clear the field to skip.";

/**
 * What O1 collects: how warm the person runs, where they run, and which
 * units they read in.
 *
 * **Everything except the thermal level is optional, and that is the
 * requirement rather than laziness.** A denied geolocation permission must
 * not block onboarding, and the manual city fallback is a label with no
 * coordinates behind it — so a runner can finish O1 having answered one
 * question, which is the two-tap target.
 *
 * Error copy lives here rather than in the form, per the Forms & failure
 * contract: one schema, run on both sides.
 */
export const calibrationInput = z
  .object({
    thermalLevel: thermalLevelSchema,
    /**
     * The provider's name for the place the runner found and confirmed
     * (round 26 #12) — a label for a human, never parsed into coordinates.
     * Up to 200, because it is Visual Crossing's `resolvedAddress`, which
     * the weather module caps there.
     */
    cityLabel: z
      .string()
      .trim()
      .min(1, { message: "Tell us where you run, or skip this." })
      .max(200)
      .optional(),
    lat: profileLatitude.optional(),
    lng: profileLongitude.optional(),
    tempUnit: tempUnitSchema.optional(),
    distanceUnit: distanceUnitSchema.optional(),
  })
  // A label with no coordinates is only ever typed text nobody found: a
  // found city arrives with where it is (Use this made it the chip), the
  // browser's location arrives as coordinates alone, and a blank field is
  // no answer. Here rather than in the form, so the server refuses it too
  // (FEED-5 review).
  .refine(
    ({ cityLabel, lat, lng }) =>
      cityLabel === undefined || (lat !== undefined && lng !== undefined),
    { path: ["cityLabel"], message: CITY_UNCONFIRMED },
  );
export type Calibration = z.infer<typeof calibrationInput>;

/**
 * A place the runner found and pressed Use this on: the provider's name
 * for it and where it is (round 26 #12). What the one writer of the
 * profile's place takes (FEED-5), from O1 and from Your conditions alike.
 */
export const placeInput = z.object({
  cityLabel: z.string().trim().min(1).max(200),
  lat: profileLatitude,
  lng: profileLongitude,
});
export type Place = z.infer<typeof placeInput>;

/**
 * What the units sub-page writes: the two display units.
 *
 * **Required here, optional in `calibrationInput`, and the difference is
 * the screen.** O1 offers a guess from the locale and must let someone
 * finish having answered one question, so its units are optional. Settings
 * shows the values a person already has and asks them to confirm or change
 * them — an absent unit there would mean "unset the thing you can see",
 * which no control on that screen expresses.
 *
 * The thermal level is deliberately not here. Recalibrating is O1's
 * question, reached from settings as a link, because it is five answers
 * with a visible offset and not a row in a preferences form (requirement
 * 6). One question, one place it is asked.
 */
export const unitsInput = z.object({
  tempUnit: tempUnitSchema,
  distanceUnit: distanceUnitSchema,
});

/**
 * The sharing sub-page's one answer.
 *
 * **Its own schema, because it is its own form** (round 22, item 20:
 * *"Each sub-page is its own small form with its own Save"*). A save on
 * the units page cannot carry a stale sharing default, and the other way
 * round, because neither sends the other's field at all.
 */
export const sharingInput = z.object({
  /**
   * The per-entry toggle's starting position, never a lock: the contract
   * is "public by default with a per-entry toggle and a per-user default
   * preference", and this is only the third of those.
   */
  shareDefault: z.boolean(),
});
export type UnitsChoice = z.infer<typeof unitsInput>;
export type SharingChoice = z.infer<typeof sharingInput>;
export type Preferences = UnitsChoice & SharingChoice;

/**
 * What P2.5 writes: a brand, and optionally which one of that brand's.
 *
 * **Brand required, model optional** — design §AC rule 04. Brand alone is
 * a true answer, and the error copy says so rather than demanding both,
 * because the screen's own caption promises it ("Brand alone is enough").
 */
export const nameIdentityInput = z.object({
  brand: z
    .string()
    .trim()
    .min(1, { message: "Which brand? That alone is enough." })
    .max(60),
  model: z.string().trim().min(1).max(120).optional(),
});
export type NameIdentity = z.infer<typeof nameIdentityInput>;

/**
Which garment to name, alongside the identity to give it.
*/
export const nameGarmentInput = nameIdentityInput.extend({
  // A ULID, not any non-empty string. Wardrobe item ids are ULIDs and
  // `closet/inputs.ts` already validates them that way — this is a trust
  // boundary, and `min(1)` would wave through anything a client sent.
  itemId: ulidSchema,
});

/**
What the brand field has been typed so far.
*/
export const brandPrefixInput = z.object({ brand: z.string().max(60) });
