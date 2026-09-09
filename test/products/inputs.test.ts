import { describe, expect, it } from "vitest";

import {
  brandSearchInput,
  resolveProductInput,
} from "../../src/modules/products/inputs";

/**
 * The server functions' input contracts.
 *
 * They used to live in `functions.ts`, where nothing could reach them: that
 * file imports `createServerFn`, which drags TanStack Start's virtual
 * entries in with it, so importing it in the workers pool fails outright
 * (D-41). Thirteen mutants sat in there with no coverage at all — including
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
    expect(
      brandSearchInput.safeParse({ prefix: "a".repeat(60) }).success,
    ).toBe(true);
    expect(
      brandSearchInput.safeParse({ prefix: "a".repeat(61) }).success,
    ).toBe(false);
  });

  it("needs a prefix at all", () => {
    expect(brandSearchInput.safeParse({}).success).toBe(false);
  });
});

describe("resolveProductInput", () => {
  const valid = { brandName: "Janji", productName: "Rover Half-Zip" };

  it("takes a brand and a product name", () => {
    expect(resolveProductInput.safeParse(valid).success).toBe(true);
  });

  it("needs both — a product with no brand has no identity", () => {
    expect(resolveProductInput.safeParse({ brandName: "Janji" }).success).toBe(
      false,
    );
    expect(
      resolveProductInput.safeParse({ productName: "Rover" }).success,
    ).toBe(false);
    expect(resolveProductInput.safeParse({}).success).toBe(false);
  });

  it("holds the brand and product name bounds", () => {
    expect(
      resolveProductInput.safeParse({ ...valid, brandName: "a".repeat(60) })
        .success,
    ).toBe(true);
    expect(
      resolveProductInput.safeParse({ ...valid, brandName: "a".repeat(61) })
        .success,
    ).toBe(false);
    expect(
      resolveProductInput.safeParse({ ...valid, productName: "a".repeat(120) })
        .success,
    ).toBe(true);
    expect(
      resolveProductInput.safeParse({ ...valid, productName: "a".repeat(121) })
        .success,
    ).toBe(false);
  });

  it("takes an https source URL and refuses any other scheme", () => {
    // The value ends up in an href on the product page.
    expect(
      resolveProductInput.safeParse({
        ...valid,
        sourceUrl: "https://janji.com/rover",
      }).success,
    ).toBe(true);
    expect(
      resolveProductInput.safeParse({ ...valid, sourceUrl: "not a url" })
        .success,
    ).toBe(false);
  });

  it("does not require a source URL", () => {
    expect(resolveProductInput.safeParse(valid).success).toBe(true);
  });
});
