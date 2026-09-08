import { describe, expect, it } from "vitest";

import { garmentSchema } from "../src/lib/contracts";
import {
  allGarmentTypes,
  hasGarmentAttribute,
  garmentAttributeKeys,
  garmentCategoriesInOrder,
  garmentFieldSpec,
  garmentTypesFor,
} from "../src/lib/garment-fields";
import {
  climateBands,
  TAP_LISTS,
} from "../src/modules/closet/tap-list-data";
import { ICONS } from "../src/ui/icons";

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

  it("names every garment type after the glyph that draws it", () => {
    // A garment's icon *is* its type — `<Icon name={item.type}>` with no
    // lookup between. That only holds while the two vocabularies agree, and
    // nothing else would notice if a pack revision renamed a glyph: the
    // union would still compile and the closet would render nothing.
    //
    // This is the derive-don't-mirror rule at a boundary where deriving is
    // impossible (the pack is untyped JS in a read-only archive), so the
    // agreement is pinned instead. Same reasoning as the manifest pin in
    // test/ui/icons.test.tsx, one level up.
    for (const type of allGarmentTypes) {
      const glyph = ICONS[type as keyof typeof ICONS] as
        | { group: string }
        | undefined;
      expect(glyph, `no glyph named "${type}"`).toBeDefined();
      expect(glyph?.group, `"${type}" is not a garment glyph`).toBe("garment");
    }
  });

  it("gives every category at least one type, and never shares one", () => {
    // Overlap would make `type` ambiguous about its category, which is the
    // whole reason the table is keyed by category rather than being one flat
    // enum. `gloves`/`socks`/`shoes` name a category *and* its only type;
    // that is one-to-one, not overlap.
    const owner = new Map<string, string>();
    for (const category of garmentCategoriesInOrder) {
      const types = garmentTypesFor(category);
      expect(types.length, `${category} has no types`).toBeGreaterThan(0);
      for (const type of types) {
        expect(owner.get(type), `"${type}" is in two categories`).toBeUndefined();
        owner.set(type, category);
      }
    }
  });

  it("accepts a type only from its own category", () => {
    expect(
      garmentSchema.safeParse({ name: "T", category: "top", type: "halfZip" })
        .success,
    ).toBe(true);
    expect(
      garmentSchema.safeParse({ name: "T", category: "top", type: "tights" })
        .success,
    ).toBe(false);
    // Optional on purpose: rows predating the column have none, and a
    // generic tap-list save legitimately does not know.
    expect(
      garmentSchema.safeParse({ name: "T", category: "top" }).success,
    ).toBe(true);
  });
  it("gives tap-list garments no type — a row label is not a type", () => {
    // Design's Z screen: type is a property of the product, written on
    // match or by enrichment and never by a user. A tap-list save creates a
    // generic garment with no product, so it has none.
    //
    // Pinned because the first version of this *did* set a type per row, on
    // the reasoning that the row is one. That is the parser design rules
    // out — "L/S" sitting in free text is not a type, and reading it as one
    // files "Crew for cold L/S days" wrong, silently, forever.
    const entries = climateBands.flatMap((band) => TAP_LISTS[band]);
    for (const entry of entries) {
      expect(
        "type" in entry.garment ? entry.garment.type : undefined,
        `${entry.key} carries a type`,
      ).toBeUndefined();
    }
  });
});