/**
 * The server functions' input contracts, kept out of `functions.ts`.
 *
 * `functions.ts` imports `createServerFn`, which drags TanStack Start's
 * virtual entries in with it — so nothing in that file can be imported by
 * a test running in the vitest workers pool, and nothing in it can be
 * mutation tested (D-41). A zod schema is a trust boundary and belongs
 * where it can be, which is here.
 */
import { z } from "zod";

import {
  brandNameSchema,
  httpsUrlSchema,
  productNameSchema,
} from "../../lib/contracts";

/**
 * The brand autocomplete prefix. Bounded because it reaches a `LIKE`: an
 * unbounded prefix is a bigger scan for an answer nobody can read.
 */
export const brandSearchInput = z.object({ prefix: z.string().max(60) });

/**
 * The screen-F identity step: brand + product together, so the form can
 * pre-fill attributes and link `product_id` in one round trip.
 */
export const resolveProductInput = z.object({
  brandName: brandNameSchema,
  productName: productNameSchema,
  sourceUrl: httpsUrlSchema.optional(),
});
