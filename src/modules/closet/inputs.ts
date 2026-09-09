/**
 * The closet server functions' input contracts, kept out of `functions.ts`.
 *
 * That file imports `createServerFn`, so nothing in it can be imported by a
 * test or reached by mutation testing (D-41). A zod schema is a trust
 * boundary and belongs where it can be exercised, which is here.
 */
import { z } from "zod";

import {
  garmentCategories,
  garmentSchema,
  performanceBucketSchema,
} from "../../lib/contracts";
import { ulidSchema } from "../../lib/ids";

/**
 * Screen C's filter set. The category list is `garmentCategories` rather
 * than an enum written out again — it was written out twice before, and
 * the copy here was free to fall behind the union it filters.
 */
export const closetFiltersInput = z.object({
  category: z.enum(garmentCategories).optional(),
  minTempC: z.number().optional(),
  maxTempC: z.number().optional(),
  windResistant: z.boolean().optional(),
  waterResistant: z.boolean().optional(),
  // The same four values were a TS union in service.ts and an enum here,
  // free to drift. One list in contracts now; the type derives from it.
  performance: performanceBucketSchema.optional(),
  includeRetired: z.boolean().optional(),
});

export const itemIdInput = z.object({ itemId: ulidSchema });

/**
 * The garment plus the key that identifies *this* submission of it.
 *
 * A separate wrapper rather than a field on `garmentSchema`, because the
 * key is a property of the request and not of the thing being saved —
 * putting it in the contract would mean every read of a garment carries it.
 */
export const newItemInput = z.object({
  garment: garmentSchema,
  idempotencyKey: ulidSchema.optional(),
});

export const updateItemInput = z.object({
  itemId: ulidSchema,
  garment: garmentSchema,
});

/**
 * The multipart body, refused early if it is not one.
 *
 * Here rather than inline in the server function's validator for the same
 * reason as the schemas: a `throw` is a decision, and a decision inside
 * `functions.ts` is one no test can reach.
 */
export function requireFormData(data: unknown): FormData {
  if (!(data instanceof FormData)) {
    throw new TypeError("Expected multipart form data.");
  }
  return data;
}
