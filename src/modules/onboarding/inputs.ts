import { z } from "zod";

import { ulidSchema } from "../../lib/ids";

import {
  distanceUnitSchema,
  tempUnitSchema,
  thermalLevelSchema,
} from "../../lib/contracts";

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
export const calibrationInput = z.object({
  thermalLevel: thermalLevelSchema,
  /**
   * Free text, because the fallback is someone typing where they live. It
   * is a label for a human, never parsed into coordinates.
   */
  cityLabel: z
    .string()
    .trim()
    .min(1, { message: "Tell us where you run, or skip this." })
    .max(120)
    .optional(),
  lat: z.number().min(-90).max(90).optional(),
  lng: z.number().min(-180).max(180).optional(),
  tempUnit: tempUnitSchema.optional(),
  distanceUnit: distanceUnitSchema.optional(),
});
export type Calibration = z.infer<typeof calibrationInput>;

/**
 * What the settings screen writes: the two display units and the sharing
 * default.
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
export const preferencesInput = z.object({
  tempUnit: tempUnitSchema,
  distanceUnit: distanceUnitSchema,
  /**
   * The per-entry toggle's starting position, never a lock: the contract
   * is "public by default with a per-entry toggle and a per-user default
   * preference", and this is only the third of those.
   */
  shareDefault: z.boolean(),
});
export type Preferences = z.infer<typeof preferencesInput>;

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
