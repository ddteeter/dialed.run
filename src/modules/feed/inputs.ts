/**
 * The feed server functions' input contracts, kept out of `functions.ts`.
 *
 * That file imports `createServerFn`, so nothing in it can be imported by
 * a test or reached by mutation testing (D-41). A zod schema is a trust
 * boundary and belongs where it can be exercised, which is here.
 */
import { z } from "zod";

import {
  entryTagSchema,
  itemFlagSchema,
  latitudeSchema,
  longitudeSchema,
  verdictSchema,
} from "../../lib/contracts";
import { ulidSchema } from "../../lib/ids";
import { allowedPhotoTypes } from "../../lib/photo-constraints";

/**
 * The picker's selection. Capped because it reaches an ownership read and
 * an insert; a kit is a handful of pieces, not a wardrobe.
 */
export const attachKitInput = z.object({
  runId: ulidSchema,
  itemIds: z.array(ulidSchema).max(40),
});

/**
 * The picker asks for conditions when it has them and shows the whole
 * closet when it does not, so both coordinates are optional together.
 */
export const pickerGroupsInput = z.object({
  lat: latitudeSchema.optional(),
  lng: longitudeSchema.optional(),
});

/**
 * One schema for both surfaces that take a coordinate: the prefill lookup
 * and the conditions consensus ask the same question of the same input.
 */
export const coordinatesInput = z.object({
  lat: latitudeSchema,
  lng: longitudeSchema,
});

/**
 * And for a runner who will not share one: E2-lite's location-denied
 * recovery, the city typed instead. O1's bounds, and a sentence that names
 * the fix.
 */
export const conditionsCityInput = z.object({
  cityLabel: z
    .string()
    .trim()
    .min(1, { message: "Type the city you run in." })
    .max(120),
});

export const itemFlagInput = z.object({
  itemId: ulidSchema,
  flag: itemFlagSchema.optional(),
  note: z.string().max(280).optional(),
});

/**
 * The whole A3 submission. `tags` is capped at the number of tags that
 * exist — a request naming more than that is either a repeat or a bug.
 */
/**
 * **A verdict is per-run; per-item signal is the `flag`.** Asked on review
 * and worth stating where the schema is, because the two are easy to
 * conflate and the app has both:
 *
 * - `verdict` is one integer −2..+2 for the whole outfit (0 = dialed).
 * - `itemFlags` carries an optional `too_much` / `not_enough` per garment,
 *   which is exactly the jacket-too-hot-and-tights-too-cold case — at
 *   lower resolution, because a flag has a direction and no magnitude.
 *
 * So "too cold" on a run whose half-tights were the only problem is
 * already expressible: the run reads −1 and the tights carry
 * `not_enough`. What is *not* expressible is a magnitude per garment, or
 * per-half-of-body aggregation. Whether the Call needs that fidelity is
 * a real open question and is recorded as D-95 rather than guessed at
 * here; `docs/contracts.md` is the place it would change.
 */
export const submitVerdictInput = z.object({
  entryId: ulidSchema,
  verdict: verdictSchema,
  isPublic: z.boolean(),
  caption: z.string().max(280).optional(),
  tags: z.array(entryTagSchema).max(entryTagSchema.options.length),
  itemFlags: z.array(itemFlagInput),
});

/**
 * One row of the verdict backlog, saved.
 *
 * The same two facts `attachKitInput` and `submitVerdictInput` already
 * carry, because a row *is* those two screens laid flat — the cap on
 * `itemIds` and the verdict's own scale are read from the same schemas
 * rather than restated, so a change to either reaches the table.
 */
export const saveBacklogRowInput = z.object({
  runId: attachKitInput.shape.runId,
  itemIds: attachKitInput.shape.itemIds,
  verdict: submitVerdictInput.shape.verdict,
});

export const bandCountsInput = z.object({
  bandFloorC: z.number(),
  excludeEntryId: ulidSchema.optional(),
});

export const bandSignalsInput = z.object({
  bandFloorC: z.number(),
  entryId: ulidSchema,
});

export const itemBandStatInput = z.object({
  itemId: ulidSchema,
  bandFloorC: z.number(),
});

export const entryIdInput = z.object({ entryId: ulidSchema });

export const userIdInput = z.object({ userId: ulidSchema });

export const feedInput = z.object({
  cursor: z.object({ createdAt: z.number().int(), id: z.string() }).optional(),
});

export const searchInput = z.object({ prefix: z.string().max(60) });

export const uploadPhotoFields = z.object({
  entryId: ulidSchema,
  contentType: z.enum(allowedPhotoTypes),
  // A multipart field, so it arrives as a string like every other one.
  idempotencyKey: ulidSchema.optional(),
});
