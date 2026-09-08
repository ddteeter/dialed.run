import { drizzle } from "drizzle-orm/d1";
import { describe, expect, it } from "vitest";

import { env } from "../../src/env";
import { newUlid } from "../../src/lib/ids";
import {
  createOrGetBrand,
  createOrGetProduct,
  getProductAttributeDefaults,
  getProductAttributeDefaultsBulk,
  resolveProduct,
  searchBrands,
  searchProducts,
} from "../../src/modules/products/service";
import { brands } from "../../src/db/schema-core";
import { CURATED_BRANDS } from "../../src/modules/products/seed-brands";

function db() {
  return drizzle(env.DIALED_CORE);
}

describe("products: brand create-if-missing", () => {
  it("two callers typing the same brand (different case/punctuation) share one row", async () => {
    const client = db();
    const first = await createOrGetBrand(client, "Ciele Athletics");
    const second = await createOrGetBrand(client, "ciele  athletics™");
    expect(second.id).toBe(first.id);
  });

  it("prefix autocomplete finds a brand by its normalized prefix", async () => {
    const client = db();
    await createOrGetBrand(client, "Tracksmith");
    const results = await searchBrands(client, "track");
    expect(results.some((brand) => brand.name === "Tracksmith")).toBe(true);
  });

  it("rejects a brand name with no letters or digits", async () => {
    await expect(createOrGetBrand(db(), "!!!")).rejects.toThrow();
  });
});

describe("products: product create-if-missing", () => {
  it("two users typing the same brand+model share one product row", async () => {
    const client = db();
    const brand = await createOrGetBrand(client, "Janji");
    const userA = newUlid();
    const userB = newUlid();
    const first = await createOrGetProduct(client, {
      brandId: brand.id,
      name: "Rover Half-Zip",
      createdBy: userA,
    });
    const second = await createOrGetProduct(client, {
      brandId: brand.id,
      name: "rover  half zip",
      createdBy: userB,
    });
    expect(second.id).toBe(first.id);
  });

  it("scopes autocomplete to one brand and active status", async () => {
    const client = db();
    const brandA = await createOrGetBrand(client, "Brand Alpha");
    const brandB = await createOrGetBrand(client, "Brand Beta");
    const userId = newUlid();
    await createOrGetProduct(client, {
      brandId: brandA.id,
      name: "Speed Short",
      createdBy: userId,
    });
    await createOrGetProduct(client, {
      brandId: brandB.id,
      name: "Speed Short",
      createdBy: userId,
    });
    const results = await searchProducts(client, brandA.id, "speed");
    expect(results).toHaveLength(1);
    expect(results[0]?.brandId).toBe(brandA.id);
  });

  it("resolveProduct resolves brand + product together", async () => {
    const client = db();
    const userId = newUlid();
    const { brand, product } = await resolveProduct(client, {
      brandName: "Satisfy",
      productName: "Justice Short",
      createdBy: userId,
    });
    expect(product.brandId).toBe(brand.id);
    expect(product.name).toBe("Justice Short");
  });
});

describe("products: attribute defaults", () => {
  it("returns undefined defaults for a product with no attributes set", async () => {
    const client = db();
    const userId = newUlid();
    const { product } = await resolveProduct(client, {
      brandName: "Blank Brand",
      productName: "Blank Product",
      createdBy: userId,
    });
    const defaults = await getProductAttributeDefaults(client, product.id);
    expect(defaults).toBeDefined();
    expect(defaults?.weight).toBeNull();
  });

  it("bulk defaults return an empty map for an empty id list", async () => {
    const defaults = await getProductAttributeDefaultsBulk(db(), []);
    expect(defaults.size).toBe(0);
  });
});

describe("products: the curated brand seed", () => {
  /**
   * Seeding moved from a runtime `ensureBrandsSeeded` guard to a data
   * migration, so what needs proving moved with it: the migration ran, it
   * produced one row per brand, and the ids it wrote are the derived ones
   * (which is what makes re-applying it to a fresh database safe).
   */
  it("is present from the migration, with no duplicates", async () => {
    const client = db();
    const results = await searchBrands(client, "nike", CURATED_BRANDS.length);
    expect(results.filter((brand) => brand.name === "Nike")).toHaveLength(1);
  });

  it("seeded every brand in the curated list", async () => {
    const client = db();
    const rows = await client.select().from(brands);
    const seeded = rows.filter((row) => row.seeded);
    expect(seeded).toHaveLength(CURATED_BRANDS.length);
  });

  it("normalises names so autocomplete matches regardless of case", async () => {
    const client = db();
    const upper = await searchBrands(client, "NEW BAL", 5);
    expect(upper.map((brand) => brand.name)).toContain("New Balance");
  });
});
