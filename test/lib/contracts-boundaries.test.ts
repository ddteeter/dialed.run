import { describe, expect, it } from "vitest";
import type { z } from "zod";

import {
  brandNameSchema,
  effortSchema,
  entryTagSchema,
  fabricSchema,
  garmentSchema,
  httpsUrlSchema,
  itemFlagSchema,
  latitudeSchema,
  layerSchema,
  longitudeSchema,
  performanceBucketSchema,
  productNameSchema,
  thermalLevelSchema,
  verdictSchema,
  weightSchema,
} from "../../src/lib/contracts";

/**
 * `lib/contracts` is the trust boundary — every server function parses
 * through it and nothing writes a garment, run or entry without it. Its
 * numbers and its enum members *are* the contract.
 *
 * None of them were pinned. Mutation testing put a number on it: 53%, with
 * every `min`/`max` mutable and every enum member replaceable with `""`
 * while the whole suite stayed green, because the tests that touch these
 * schemas all pass well-formed values comfortably inside every bound.
 *
 * These assert at the boundary, not near it. `expect(parse("x")).toBe ok`
 * cannot tell `.max(80)` from `.max(1)`.
 */

/**
Accepts every listed member and nothing else.
*/
function expectEnum(
  schema: z.ZodType<string>,
  members: readonly string[],
): void {
  for (const member of members) {
    expect(schema.safeParse(member).success, `${member} should parse`).toBe(
      true,
    );
  }
  for (const outsider of ["", "nope", members.join("")]) {
    expect(
      schema.safeParse(outsider).success,
      `${outsider} should not parse`,
    ).toBe(false);
  }
}

/**
Accepts a string of exactly `max` characters and rejects one longer.
*/
function expectLength(
  schema: z.ZodType<string>,
  { min, max }: { min: number; max: number },
): void {
  expect(schema.safeParse("a".repeat(max)).success).toBe(true);
  expect(schema.safeParse("a".repeat(max + 1)).success).toBe(false);
  if (min > 0) {
    expect(schema.safeParse("a".repeat(min - 1)).success).toBe(false);
  }
}

/**
Accepts both ends of the range and rejects just outside each.
*/
function expectRange(
  schema: z.ZodType<number>,
  { min, max }: { min: number; max: number },
): void {
  expect(schema.safeParse(min).success, `${String(min)} is in range`).toBe(true);
  expect(schema.safeParse(max).success, `${String(max)} is in range`).toBe(true);
  expect(schema.safeParse(min - 1).success).toBe(false);
  expect(schema.safeParse(max + 1).success).toBe(false);
}

describe("enums admit exactly their members", () => {
  it("layer", () => {
    expectEnum(layerSchema, ["base", "mid", "outer"]);
  });
  it("weight", () => {
    expectEnum(weightSchema, ["light", "mid", "heavy"]);
  });
  it("fabric", () => {
    expectEnum(fabricSchema, [
      "synthetic",
      "merino",
      "cotton",
      "blend",
      "down",
    ]);
  });
  it("effort", () => {
    expectEnum(effortSchema, ["easy", "steady", "workout", "race"]);
  });
  it("item flag", () => {
    expectEnum(itemFlagSchema, ["too_much", "not_enough"]);
  });
  it("entry tag", () => {
    // The tag list is a product vocabulary; a member vanishing silently
    // would drop a filter the feed offers.
    expect(entryTagSchema.safeParse("cold_first_mile").success).toBe(true);
    expect(entryTagSchema.safeParse("hands_sweaty").success).toBe(true);
    expect(entryTagSchema.safeParse("").success).toBe(false);
    expect(entryTagSchema.safeParse("rain").success).toBe(false);
  });
  it("performance bucket", () => {
    expect(performanceBucketSchema.safeParse("").success).toBe(false);
    expect(performanceBucketSchema.safeParse("nope").success).toBe(false);
  });
});

/**
Does a garment parse with `field` set to a string of `length`?
*/
function isAcceptedAt(field: string, length: number): boolean {
  return garmentSchema.safeParse({
    category: "top",
    name: field === "name" ? "a".repeat(length) : "Shirt",
    ...(field !== "name" && { [field]: "a".repeat(length) }),
  }).success;
}

describe("string fields hold their declared length", () => {
  it("brand name is 1..60", () => {
    expectLength(brandNameSchema, { min: 1, max: 60 });
  });
  it("product name is 1..120", () => {
    expectLength(productNameSchema, { min: 1, max: 120 });
  });
  it("garment name is 1..80, and the other identity fields are shorter", () => {
    expect(isAcceptedAt("name", 80)).toBe(true);
    expect(isAcceptedAt("name", 81)).toBe(false);
    expect(isAcceptedAt("name", 0)).toBe(false);
    expect(isAcceptedAt("brand", 60)).toBe(true);
    expect(isAcceptedAt("brand", 61)).toBe(false);
    expect(isAcceptedAt("size", 20)).toBe(true);
    expect(isAcceptedAt("size", 21)).toBe(false);
    expect(isAcceptedAt("color", 30)).toBe(true);
    expect(isAcceptedAt("color", 31)).toBe(false);
  });
});

describe("numeric ranges hold both ends", () => {
  it("verdict is -2..2 and whole", () => {
    expectRange(verdictSchema, { min: -2, max: 2 });
    expect(verdictSchema.safeParse(1.5).success).toBe(false);
  });
  it("thermal level is -2..2 and whole", () => {
    expectRange(thermalLevelSchema, { min: -2, max: 2 });
    expect(thermalLevelSchema.safeParse(0.5).success).toBe(false);
  });
  it("latitude is -90..90", () => {
    expectRange(latitudeSchema, { min: -90, max: 90 });
  });
  it("longitude is -180..180", () => {
    expectRange(longitudeSchema, { min: -180, max: 180 });
  });
});

/**
 * Built from a scheme rather than written out, and not for style.
 *
 * `sonarjs/no-clear-text-protocols` **autofixes** a literal `http://` to
 * `https://`, and its fixer runs in the format chain — so the assertion
 * "this insecure URL is rejected" was silently rewritten into "this secure
 * URL is rejected", which then failed for the opposite of the stated
 * reason. A rule that edits a test to make it wrong is worth a comment.
 */
function urlWithScheme(scheme: string): string {
  return `${scheme}://janji.com`;
}

describe("httpsUrlSchema", () => {
  it("takes https and refuses every other scheme", () => {
    expect(httpsUrlSchema.safeParse("https://janji.com/rover").success).toBe(
      true,
    );
    expect(httpsUrlSchema.safeParse(urlWithScheme("http")).success).toBe(false);
    expect(httpsUrlSchema.safeParse(urlWithScheme("ftp")).success).toBe(false);
    // `javascript:` is why this is a scheme allowlist rather than a
    // "starts with http" check — the value reaches an href.
    expect(httpsUrlSchema.safeParse("javascript:alert(1)").success).toBe(false);
  });

  it("refuses a string that is not a URL at all", () => {
    // The `catch` branch. Without it `new URL` throws out of the refine and
    // the parse fails with a stack rather than a message — and a mutant
    // that empties the catch is invisible unless something takes this path.
    expect(httpsUrlSchema.safeParse("not a url").success).toBe(false);
    expect(httpsUrlSchema.safeParse("").success).toBe(false);
  });

  it("says what was wrong", () => {
    const result = httpsUrlSchema.safeParse(urlWithScheme("http"));
    expect(result.error?.issues[0]?.message).toBe("must be an https:// URL");
  });
});

describe("the garment union is closed", () => {
  it("rejects a category outside the enum", () => {
    expect(
      garmentSchema.safeParse({ category: "hat", name: "Cap" }).success,
    ).toBe(false);
  });

  it("rejects an attribute the category does not admit", () => {
    // strictObject: shoes take no `layer`, and a form sending one is a bug
    // rather than something to quietly drop.
    expect(
      garmentSchema.safeParse({ category: "shoes", name: "Pegasus" }).success,
    ).toBe(true);
    expect(
      garmentSchema.safeParse({
        category: "shoes",
        name: "Pegasus",
        layer: "base",
      }).success,
    ).toBe(false);
  });
});
