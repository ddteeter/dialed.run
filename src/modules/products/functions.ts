/**
 * Server-fn glue (imported directly by route files, per modules/auth's
 * pattern) — keeps ./index.ts loadable in the vitest workers pool with no
 * TanStack virtual entries.
 */
import { createServerFn } from "@tanstack/react-start";
import { drizzle } from "drizzle-orm/d1";

import { env } from "../../env";
import { requireUserId } from "../auth";
import { brandSearchInput } from "./inputs";
import { searchBrands } from "./service";

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

// A product is made only where a garment is written (`closet`'s
// `withResolvedProduct`), which is where design 133 (D-113 Q1) clamps it
// for an unconfirmed runner. There was a `resolveProductFn` here that made
// a brand and a product for anyone signed in, and no route called it.
