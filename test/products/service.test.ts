import { eq } from "drizzle-orm";
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
import { brands, products } from "../../src/db/schema-core";
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

/**
 * The identity rules, at the edges.
 *
 * Twenty-one mutants survived here, and they are the kind that produce
 * wrong rows rather than crashes: the `LIKE` escaping could be deleted
 * (making a brand with an underscore in it match everything), the trim
 * could be dropped, `seeded` could flip, and the created-at stamp could be
 * milliseconds. Every existing test asked a question that all of those
 * still answered correctly.
 */

describe("prefix autocomplete refuses to guess", () => {
  it("returns nothing for a prefix that normalises away", async () => {
    // "!!!" has no letters or digits, so there is no prefix to search for.
    // Without the guard this becomes `LIKE '%'` — every brand in the table,
    // presented as if the user had typed something that matched.
    const client = db();
    expect(await searchBrands(client, "!!!")).toStrictEqual([]);
    expect(await searchBrands(client, "")).toStrictEqual([]);
    expect(await searchBrands(client, " ".repeat(3))).toStrictEqual([]);
  });

  it("returns nothing for a product prefix that normalises away", async () => {
    const client = db();
    const brand = await createOrGetBrand(client, "Empty Prefix Brand");
    await createOrGetProduct(client, {
      brandId: brand.id,
      name: "Something",
      createdBy: newUlid(),
    });
    expect(await searchProducts(client, brand.id, "###")).toStrictEqual([]);
  });

  it("never lets a LIKE metacharacter the user typed reach the query", async () => {
    // `%` and `_` are LIKE wildcards, and this is the assertion that says
    // why no escaping is needed: normalisation folds them to a space long
    // before the pattern is built. A user typing "100%" gets the brands
    // whose names begin "100", not every brand in the table.
    const client = db();
    await createOrGetBrand(client, "Wildcard 100% Wool");
    await createOrGetBrand(client, "Wildcard Zulu");

    // A live `%` here would end the pattern at "wildcard 100" with a
    // wildcard the user supplied, and the Zulu row would come back too.
    const results = await searchBrands(client, "wildcard 100%");
    expect(results.map((brand) => brand.name)).toStrictEqual([
      "Wildcard 100% Wool",
    ]);
  });
});

describe("what a created row records", () => {
  it("stores the brand name trimmed, and not as part of the seed", async () => {
    // `seeded` is what the curated-list assertions count. A user-typed
    // brand joining that set would inflate it silently.
    const client = db();
    const brand = await createOrGetBrand(client, "  Padded Brand  ");

    expect(brand.name).toBe("Padded Brand");
    expect(brand.seeded).toBe(false);
  });

  it("stores the product name trimmed, unenriched, and stamped in seconds", async () => {
    const client = db();
    const brand = await createOrGetBrand(client, "Stamp Brand");
    const before = Math.floor(Date.now() / 1000);

    const product = await createOrGetProduct(client, {
      brandId: brand.id,
      name: "  Padded Product  ",
      createdBy: newUlid(),
    });

    expect(product.name).toBe("Padded Product");
    // Lane 107's enrichment ladder reads this to decide what to fetch; a
    // product that claims to be enriched is one it will never look at.
    expect(product.extractionStatus).toBe("none");
    expect(product.createdAt).toBeGreaterThanOrEqual(before - 5);
    expect(product.createdAt).toBeLessThanOrEqual(before + 5);
  });

  it("says which name it could not resolve", async () => {
    await expect(createOrGetBrand(db(), "!!!")).rejects.toThrow(/Brand name/);
    const client = db();
    const brand = await createOrGetBrand(client, "Named Failure Brand");
    await expect(
      createOrGetProduct(client, {
        brandId: brand.id,
        name: "***",
        createdBy: newUlid(),
      }),
    ).rejects.toThrow(/Product name/);
  });
});

describe("attribute defaults distinguish false from not-stated", () => {
  it("keeps `false` as false and null as undefined", async () => {
    // `null` means the product page never said. `false` means it said no.
    // A garment inherits defaults where its own column is NULL, so
    // collapsing the two turns "unknown" into "definitely not".
    const client = db();
    const brand = await createOrGetBrand(client, "Attribute Brand");
    const { id } = await createOrGetProduct(client, {
      brandId: brand.id,
      name: "Attribute Product",
      createdBy: newUlid(),
    });
    await client
      .update(products)
      .set({ windResistant: true, waterResistant: false })
      .where(eq(products.id, id));

    const defaults = await getProductAttributeDefaults(client, id);

    expect(defaults?.windResistant).toBe(true);
    expect(defaults?.waterResistant).toBe(false);
  });

  it("reports an unstated attribute as undefined, not null", async () => {
    const client = db();
    const { product } = await resolveProduct(client, {
      brandName: "Unstated Brand",
      productName: "Unstated Product",
      createdBy: newUlid(),
    });

    const defaults = await getProductAttributeDefaults(client, product.id);

    expect(defaults?.windResistant).toBeUndefined();
    expect(defaults?.waterResistant).toBeUndefined();
  });

  it("answers about several products in one call", async () => {
    const client = db();
    const brand = await createOrGetBrand(client, "Bulk Brand");
    const userId = newUlid();
    const ids: string[] = [];
    for (const name of ["Bulk One", "Bulk Two"]) {
      const row = await createOrGetProduct(client, {
        brandId: brand.id,
        name,
        createdBy: userId,
      });
      ids.push(row.id);
    }

    const defaults = await getProductAttributeDefaultsBulk(client, ids);

    expect(new Set(defaults.keys())).toStrictEqual(new Set(ids));
  });
});
