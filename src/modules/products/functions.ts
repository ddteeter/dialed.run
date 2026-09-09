/**
 * Server-fn glue (imported directly by route files, per modules/auth's
 * pattern) — keeps ./index.ts loadable in the vitest workers pool with no
 * TanStack virtual entries.
 */
import { createServerFn } from "@tanstack/react-start";
import { drizzle } from "drizzle-orm/d1";

import { env } from "../../env";
import { requireUserId } from "../auth";
import { brandSearchInput, resolveProductInput } from "./inputs";
import { resolveProduct, searchBrands } from "./service";

function db() {
  return drizzle(env.DIALED_CORE);
}

export const searchBrandsFn = createServerFn({ method: "GET" })
  .validator((data: unknown) => brandSearchInput.parse(data))
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

export const resolveProductFn = createServerFn({ method: "POST" })
  .validator((data: unknown) => resolveProductInput.parse(data))
  .handler(async ({ data }) => {
    const userId = await requireUserId();
    return resolveProduct(db(), { ...data, createdBy: userId });
  });
