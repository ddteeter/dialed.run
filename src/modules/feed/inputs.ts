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

export const itemFlagInput = z.object({
  itemId: ulidSchema,
  flag: itemFlagSchema.optional(),
  note: z.string().max(280).optional(),
});

/**
 * The whole A3 submission. `tags` is capped at the number of tags that
 * exist — a request naming more than that is either a repeat or a bug.
 */
export const submitVerdictInput = z.object({
  entryId: ulidSchema,
  verdict: verdictSchema,
  isPublic: z.boolean(),
  caption: z.string().max(280).optional(),
  tags: z.array(entryTagSchema).max(entryTagSchema.options.length),
  itemFlags: z.array(itemFlagInput),
});

export const bandCountsInput = z.object({
  bandFloorC: z.number(),
  excludeEntryId: ulidSchema.optional(),
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
