import { sql } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { z } from "zod";

import { CORRECTION_FIELDS } from "../../src/lib/contracts/product-corrections";
import {
  currentValues,
  productFactColumns,
  productPatch,
} from "../../src/modules/products/correction-values";

const NOTHING = z.null().parse(JSON.parse("null"));

const BLANK = {
  name: "Harrier",
  weight: NOTHING,
  fabric: NOTHING,
  windResistant: NOTHING,
  waterResistant: NOTHING,
  fabricComposition: NOTHING,
  sourceUrl: NOTHING,
};

describe("a correction's value written to the product", () => {
  it("writes each field to its own columns", () => {
    expect(productPatch("name", "Harrier Half-Zip")).toStrictEqual({
      name: "Harrier Half-Zip",
      normalizedName: "harrier half zip",
    });
    expect(productPatch("weight", "heavy")).toStrictEqual({ weight: "heavy" });
    expect(productPatch("fabric", "merino")).toStrictEqual({
      fabric: "merino",
    });
    expect(productPatch("wind", "yes")).toStrictEqual({ windResistant: true });
    expect(productPatch("wind", "no")).toStrictEqual({ windResistant: false });
    expect(productPatch("water", "yes")).toStrictEqual({
      waterResistant: true,
    });
    expect(productPatch("water", "no")).toStrictEqual({
      waterResistant: false,
    });
    expect(productPatch("composition", "100% merino")).toStrictEqual({
      fabricComposition: "100% merino",
      fabricParts: sql`NULL`,
    });
    expect(productPatch("link", "https://shop.example/h")).toStrictEqual({
      sourceUrl: "https://shop.example/h",
    });
  });

  it("refuses an enum value the closet form would not offer", () => {
    expect(() => productPatch("weight", "medium")).toThrow();
    expect(() => productPatch("fabric", "silk")).toThrow();
  });
});

describe("what the product says now", () => {
  it("says only what the product states", () => {
    expect(currentValues(BLANK)).toStrictEqual({ name: "Harrier" });
  });

  it("reads every field back as a correction would say it", () => {
    expect(
      currentValues({
        name: "Harrier",
        weight: "light",
        fabric: "merino",
        windResistant: true,
        waterResistant: false,
        fabricComposition: "100% merino",
        sourceUrl: "https://shop.example/h",
      }),
    ).toStrictEqual({
      name: "Harrier",
      weight: "light",
      fabric: "merino",
      wind: "yes",
      water: "no",
      composition: "100% merino",
      link: "https://shop.example/h",
    });
  });

  it("reads the columns it needs, one per field", () => {
    expect(Object.keys(productFactColumns())).toHaveLength(
      CORRECTION_FIELDS.length,
    );
  });
});
