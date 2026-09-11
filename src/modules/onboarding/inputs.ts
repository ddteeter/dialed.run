import { z } from "zod";

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
