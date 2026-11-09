import { describe, expect, it } from "vitest";

import { newUlid } from "../../src/lib/ids";
import {
  brandSearchInput,
  correctionContextInput,
} from "../../src/modules/products/inputs";

/**
 * The server functions' input contracts.
 *
 * They used to live in `functions.ts`, where nothing could reach them: that
 * file imports `createServerFn`, which drags TanStack Start's virtual
 * entries in with it, so importing it in the workers pool fails outright
 * (R-41). Thirteen mutants sat in there with no coverage at all — including
 * the `.max(60)` on a value that reaches a `LIKE`.
 */

describe("brandSearchInput", () => {
  it("takes a prefix, empty included", () => {
    // An empty prefix is what an autocomplete sends on the first keystroke
    // and again on backspace; the service answers it with an empty list
    // rather than an error.
    expect(brandSearchInput.safeParse({ prefix: "" }).success).toBe(true);
    expect(brandSearchInput.safeParse({ prefix: "jan" }).success).toBe(true);
  });

  it("bounds the prefix at 60 characters", () => {
    // The prefix reaches a `LIKE`. An unbounded one is a bigger scan for an
    // answer nobody can read.
    expect(brandSearchInput.safeParse({ prefix: "a".repeat(60) }).success).toBe(
      true,
    );
    expect(brandSearchInput.safeParse({ prefix: "a".repeat(61) }).success).toBe(
      false,
    );
  });

  it("needs a prefix at all", () => {
    expect(brandSearchInput.safeParse({}).success).toBe(false);
  });
});

describe("correctionContextInput", () => {
  it("takes the product's ULID, and nothing else", () => {
    const productId = newUlid();
    expect(correctionContextInput.parse({ productId })).toStrictEqual({
      productId,
    });
  });

  it("refuses no product, or one that is not a ULID", () => {
    expect(correctionContextInput.safeParse({}).success).toBe(false);
    expect(
      correctionContextInput.safeParse({ productId: "nope" }).success,
    ).toBe(false);
  });
});
