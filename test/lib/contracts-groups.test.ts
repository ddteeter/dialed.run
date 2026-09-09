import { describe, expect, it } from "vitest";

import {
  extractedProductSchema,
  fabricCompositionSchema,
  fabricPartSchema,
  garmentCategories,
  productDraftSchema,
  uiGroupFor,
  uiGroupLabels,
  uiGroups,
} from "../../src/lib/contracts";

/**
 * The rest of `lib/contracts`: the closet's grouping table, and the
 * product/enrichment schemas that lane 107 will fill.
 *
 * `uiGroupFor` is a switch over every category, and half its arms were
 * never executed — the closet and the kit picker both call it, but only
 * ever with the categories their fixtures happen to use. A switch arm no
 * test reaches can return anything.
 */

describe("uiGroupFor", () => {
  it("routes every category to a real group", () => {
    // Exhaustive on purpose: this is what catches an arm returning "" or
    // falling through to its neighbour.
    for (const category of garmentCategories) {
      const group = uiGroupFor(category, undefined);
      expect(uiGroups, `${category} -> ${group}`).toContain(group);
    }
  });

  it("puts each category where screen C says", () => {
    expect(uiGroupFor("top", undefined)).toBe("tops");
    expect(uiGroupFor("bottom", undefined)).toBe("bottoms");
    expect(uiGroupFor("headwear", undefined)).toBe("hands_head");
    expect(uiGroupFor("neckwear", undefined)).toBe("hands_head");
    expect(uiGroupFor("gloves", undefined)).toBe("hands_head");
    expect(uiGroupFor("shoes", undefined)).toBe("shoes");
    expect(uiGroupFor("socks", undefined)).toBe("socks_extras");
    expect(uiGroupFor("accessory", undefined)).toBe("socks_extras");
  });

  it("sends anything worn as an outer layer to Outer, whatever it is", () => {
    // The layer check runs before the category switch, so an outer top and
    // an outer bottom both leave their own group.
    expect(uiGroupFor("top", "outer")).toBe("outer");
    expect(uiGroupFor("bottom", "outer")).toBe("outer");
    expect(uiGroupFor("top", "base")).toBe("tops");
    expect(uiGroupFor("top", "mid")).toBe("tops");
  });
});

describe("uiGroupLabels", () => {
  it("labels every group, distinctly", () => {
    // Two groups sharing a heading would render as one section on screen C.
    const labels = uiGroups.map((group) => uiGroupLabels[group]);
    for (const label of labels) expect(label.length).toBeGreaterThan(0);
    expect(new Set(labels).size).toBe(uiGroups.length);
  });
});

describe("productDraftSchema", () => {
  it("needs a brand and a name, and takes an https source", () => {
    expect(
      productDraftSchema.safeParse({ brand: "Janji", name: "Rover" }).success,
    ).toBe(true);
    expect(productDraftSchema.safeParse({ brand: "", name: "Rover" }).success).toBe(
      false,
    );
    expect(productDraftSchema.safeParse({ brand: "Janji" }).success).toBe(false);
    expect(
      productDraftSchema.safeParse({
        brand: "Janji",
        name: "Rover",
        sourceUrl: "https://janji.com/rover",
      }).success,
    ).toBe(true);
  });
});

/**
Does a single-material part parse with this percentage?
*/
function isValidPct(pct: number): boolean {
  return fabricPartSchema.safeParse({
    materials: [{ material: "merino", pct }],
  }).success;
}

describe("fabric composition", () => {
  it("keeps percentages within 0..100", () => {
    expect(isValidPct(0)).toBe(true);
    expect(isValidPct(100)).toBe(true);
    expect(isValidPct(-1)).toBe(false);
    expect(isValidPct(101)).toBe(false);
  });

  it("needs at least one material in a part", () => {
    // A part with no materials says nothing; it is the shape an extractor
    // emits when it found a heading and no content.
    expect(fabricPartSchema.safeParse({ materials: [] }).success).toBe(false);
    expect(
      fabricPartSchema.safeParse({ materials: [{ material: "nylon" }] }).success,
    ).toBe(true);
  });

  it("always keeps the verbatim string", () => {
    // D-34: `verbatim` is what was published, kept exactly. Parsed parts
    // are the interpretation and are optional; the source text is not.
    expect(fabricCompositionSchema.safeParse({ verbatim: "100% merino" }).success).toBe(
      true,
    );
    expect(fabricCompositionSchema.safeParse({ parts: [] }).success).toBe(false);
  });
});

describe("extractedProductSchema", () => {
  it("accepts an empty extraction — every field is independently optional", () => {
    // The ladder's lowest rung finds nothing, and that is a result rather
    // than a failure.
    expect(extractedProductSchema.safeParse({}).success).toBe(true);
  });

  it("still types the fields it does carry", () => {
    expect(
      extractedProductSchema.safeParse({ weight: "mid", windResistant: true })
        .success,
    ).toBe(true);
    expect(extractedProductSchema.safeParse({ weight: "medium" }).success).toBe(
      false,
    );
    expect(extractedProductSchema.safeParse({ windResistant: "yes" }).success).toBe(
      false,
    );
  });
});
