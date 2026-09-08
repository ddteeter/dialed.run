/**
 * Server-fn glue (imported directly by route files, per modules/auth's
 * pattern) — keeps ./index.ts loadable in the vitest workers pool with no
 * TanStack virtual entries.
 */
import { createServerFn } from "@tanstack/react-start";
import { drizzle } from "drizzle-orm/d1";
import { z } from "zod";

import { env } from "../../env";
import {
  brandNameSchema,
  httpsUrlSchema,
  productNameSchema,
} from "../../lib/contracts";
import { requireUserId } from "../auth";
import { resolveProduct, searchBrands } from "./service";

function db() {
  return drizzle(env.DIALED_CORE);
}

const brandSearchSchema = z.object({ prefix: z.string().max(60) });

export const searchBrandsFn = createServerFn({ method: "GET" })
  .validator((data: unknown) => brandSearchSchema.parse(data))
  .handler(async ({ data }) => {
    await requireUserId();
    const client = db();
    return searchBrands(client, data.prefix);
  });

// products.searchProducts / products.createOrGetBrand are exercised directly
// (see test/products/service.test.ts) and exported from ./index for a future
// per-brand product-autocomplete step; the v1 form only autocompletes brand
// names live (searchBrandsFn below) since product suggestions need a
// resolved brand id first — resolveProductFn below resolves both at once.

const resolveProductSchema = z.object({
  brandName: brandNameSchema,
  productName: productNameSchema,
  sourceUrl: httpsUrlSchema.optional(),
});

/**
 * The screen-F identity step: resolve brand + product together and return
 * both rows so the form can pre-fill attributes and link `product_id`.
 */
export const resolveProductFn = createServerFn({ method: "POST" })
  .validator((data: unknown) => resolveProductSchema.parse(data))
  .handler(async ({ data }) => {
    const userId = await requireUserId();
    return resolveProduct(db(), { ...data, createdBy: userId });
  });
