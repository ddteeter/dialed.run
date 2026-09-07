import { describe, expect, it } from "vitest";

import { garmentSchema } from "../src/lib/contracts";
import {
  hasGarmentAttribute,
  garmentAttributeKeys,
  garmentCategoriesInOrder,
  garmentFieldSpec,
} from "../src/lib/garment-fields";

/**
A value each attribute will accept, so only the shape decides the result.
*/
const SAMPLE: Record<(typeof garmentAttributeKeys)[number], unknown> = {
  layer: "base",
  weight: "mid",
  fabric: "merino",
  windResistant: true,
  waterResistant: true,
};

describe("garmentFieldSpec", () => {
  it("covers every category in the union, and nothing else", () => {
    expect(garmentCategoriesInOrder).toEqual([
      "top",
      "bottom",
      "headwear",
      "neckwear",
      "gloves",
      "socks",
      "shoes",
      "accessory",
    ]);
    expect(garmentFieldSpec.size).toBe(garmentCategoriesInOrder.length);
  });

  /**
   * The load-bearing test: `garmentSchema` is a strictObject union, so it
   * rejects an attribute a category does not declare. If the derived spec
   * ever drifts from the schema, one of these pairs disagrees.
   */
  it("accepts exactly the attributes the schema accepts", () => {
    for (const category of garmentCategoriesInOrder) {
      for (const key of garmentAttributeKeys) {
        const parsed = garmentSchema.safeParse({
          name: "Test garment",
          category,
          [key]: SAMPLE[key],
        });
        expect(
          parsed.success,
          `${category} + ${key}: schema says ${String(
            parsed.success,
          )}, spec says ${String(hasGarmentAttribute(category, key))}`,
        ).toBe(hasGarmentAttribute(category, key));
      }
    }
  });

  it("keeps identity-only categories free of attributes", () => {
    expect([...(garmentFieldSpec.get("accessory") ?? [])]).toEqual([]);
    expect([...(garmentFieldSpec.get("shoes") ?? [])]).toEqual([
      "waterResistant",
    ]);
  });
});
