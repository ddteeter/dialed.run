/**
 * The server functions' input contracts, kept out of `functions.ts`.
 *
 * `functions.ts` imports `createServerFn`, which drags TanStack Start's
 * virtual entries in with it — so nothing in that file can be imported by
 * a test running in the vitest workers pool, and nothing in it can be
 * mutation tested (R-41). A zod schema is a trust boundary and belongs
 * where it can be, which is here.
 */
import { z } from "zod";

import {
  correctionKeySchema,
  fileCorrectionSchema,
} from "../../lib/contracts/product-corrections";
import { ulidSchema } from "../../lib/ids";

/**
 * The brand autocomplete prefix. Bounded because it reaches a `LIKE`: an
 * unbounded prefix is a bigger scan for an answer nobody can read.
 */
export const brandSearchInput = z.object({ prefix: z.string().max(60) });

/**
 * WRONG?'s sheet (R48·129): the contract's own schema, which the sheet
 * runs first.
 */
export const fileCorrectionInput = fileCorrectionSchema;

/**
 * What the sheet reads when it opens: the runner's own waiting values.
 */
export const correctionContextInput = z.object({ productId: ulidSchema });

/**
 * The Desk's decisions (R48·130), the contract's own schemas.
 */
export const correctionKeyInput = correctionKeySchema;
export { declineCorrectionSchema as declineCorrectionInput } from "../../lib/contracts/product-corrections";
