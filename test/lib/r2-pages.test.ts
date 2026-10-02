import { describe, expect, it } from "vitest";

import { env } from "../../src/env";
import { newUlid } from "../../src/lib/ids";
import { listedPages } from "../../src/lib/sql/r2-pages";
import {
  garmentPhotoPrefix,
  photoKeyFor,
} from "../../src/lib/garment-photo-key";

/**
 * Listing a prefix a page at a time, on real R2: every object once, only
 * under the prefix, past the first page.
 */
async function collect(prefix: string, pageSize?: number) {
  const pages: string[][] = [];
  const listed = listedPages(env.IMPORTS, prefix, pageSize);
  for await (const objects of listed) {
    pages.push(objects.map((object) => object.key));
  }
  return pages;
}

describe("listedPages", () => {
  it("follows the cursor to the last page, and stays under the prefix", async () => {
    const prefix = `pages/${newUlid()}/`;
    const keys = [`${prefix}a`, `${prefix}b`, `${prefix}c`];
    for (const key of keys) await env.IMPORTS.put(key, "x");
    await env.IMPORTS.put(`pages/${newUlid()}/elsewhere`, "x");

    expect(await collect(prefix, 2)).toStrictEqual([
      [`${prefix}a`, `${prefix}b`],
      [`${prefix}c`],
    ]);
    // R2's own page size by default: one page.
    expect(await collect(prefix)).toStrictEqual([keys]);
  });

  it("yields one empty page for an empty prefix", async () => {
    expect(await collect(`pages/${newUlid()}/`)).toStrictEqual([[]]);
  });
});

describe("garmentPhotoPrefix", () => {
  it("is the prefix every garment's own photo prefix sits under", () => {
    expect(garmentPhotoPrefix("u1")).toBe("items/u1/");
    expect(photoKeyFor("u1", "g1")).toBe("items/u1/g1");
  });
});
