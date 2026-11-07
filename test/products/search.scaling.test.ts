import { drizzle } from "drizzle-orm/d1";
import { describe, expect, it } from "vitest";

import { env } from "../../src/env";
import { newUlid } from "../../src/lib/ids";
import {
  createOrGetBrand,
  createOrGetProduct,
  productsForBrand,
  searchBrands,
  searchProducts,
} from "../../src/modules/products/service";
import { queryCounts } from "../d1-spy";

/**
 * The catalogue's autocomplete reads cost the same statements over one
 * matching row as over twenty-five (design 182, part 1). They answer at
 * most AUTOCOMPLETE_LIMIT = 8 (src/modules/products/service.ts:26), so a
 * catalogue of 25 comes back capped.
 *
 * `brands` and `products` are shared catalogues that no test resets, so
 * each world is its own unique brand prefix.
 */

const LIMIT = 8;

function db() {
  return drizzle(env.DIALED_CORE);
}

/**
`count` brands sharing a prefix nobody else typed; returns the prefix.
*/
async function brandsSharing(count: number): Promise<string> {
  const prefix = `zz${newUlid()}`;
  for (let index = 0; index < count; index += 1) {
    await createOrGetBrand(db(), `${prefix} ${String(index)}`);
  }
  return prefix;
}

/**
One brand nobody else typed, with `count` active products under it.
*/
async function brandWith(count: number) {
  const name = `Scaling ${newUlid()}`;
  const brand = await createOrGetBrand(db(), name);
  for (let index = 0; index < count; index += 1) {
    await createOrGetProduct(db(), {
      brandId: brand.id,
      name: `Racer ${String(index)}`,
      createdBy: newUlid(),
    });
  }
  return { name, brandId: brand.id };
}

describe("searchBrands", () => {
  it("reads 1 and 25 matching brands in the same statements", async () => {
    const small = await brandsSharing(1);
    let found = 0;
    const one = await queryCounts(async () => {
      const result = await searchBrands(db(), small);
      found = result.length;
    });
    expect(found).toBe(1);

    const large = await brandsSharing(25);
    const twentyFive = await queryCounts(async () => {
      const result = await searchBrands(db(), large);
      found = result.length;
    });
    expect(found).toBe(LIMIT);

    expect(one.core).toBe(1);
    expect(twentyFive.core).toBe(one.core);
    expect(twentyFive.weather).toBe(one.weather);
    expect(twentyFive.coreRowsRead).toBeGreaterThan(one.coreRowsRead);
  });
});

describe("searchProducts", () => {
  it("reads 1 and 25 matching products in the same statements", async () => {
    const small = await brandWith(1);
    let found = 0;
    const one = await queryCounts(async () => {
      const result = await searchProducts(db(), small.brandId, "racer");
      found = result.length;
    });
    expect(found).toBe(1);

    const large = await brandWith(25);
    const twentyFive = await queryCounts(async () => {
      const result = await searchProducts(db(), large.brandId, "racer");
      found = result.length;
    });
    expect(found).toBe(LIMIT);

    expect(one.core).toBe(1);
    expect(twentyFive.core).toBe(one.core);
    expect(twentyFive.weather).toBe(one.weather);
    expect(twentyFive.coreRowsRead).toBeGreaterThan(one.coreRowsRead);
  });
});

describe("productsForBrand", () => {
  it("reads a brand of 1 and of 25 products in the same statements", async () => {
    // Two: the brand by its normalized name, then its products.
    const small = await brandWith(1);
    let found = 0;
    const one = await queryCounts(async () => {
      const result = await productsForBrand(db(), small.name);
      found = result.length;
    });
    expect(found).toBe(1);

    const large = await brandWith(25);
    const twentyFive = await queryCounts(async () => {
      const result = await productsForBrand(db(), large.name);
      found = result.length;
    });
    expect(found).toBe(LIMIT);

    expect(one.core).toBe(2);
    expect(twentyFive.core).toBe(one.core);
    expect(twentyFive.weather).toBe(one.weather);
    expect(twentyFive.coreRowsRead).toBeGreaterThan(one.coreRowsRead);
  });
});
