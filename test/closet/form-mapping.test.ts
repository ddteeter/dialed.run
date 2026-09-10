import { describe, expect, it } from "vitest";

import { drizzle } from "drizzle-orm/d1";

import { env } from "../../src/env";
import { garmentSchema } from "../../src/lib/contracts";
import { newUlid } from "../../src/lib/ids";
import {
  garmentAttributeKeys,
  garmentCategoriesInOrder,
  garmentFieldSpec,
} from "../../src/lib/garment-fields";
import { formValuesFromItem } from "../../src/modules/closet/form-mapping";
import {
  garmentFormSchema,
  type GarmentFormValues,
} from "../../src/modules/closet/form-schema";
import { createItem } from "../../src/modules/closet/service";
import type {
  EffectiveAttributes,
  WardrobeItemRow,
} from "../../src/modules/closet/service";

/**
 * The form-to-garment mapping, which nothing imported at all — sixty-one
 * mutants with no coverage.
 *
 * It is the seam between a flat, always-a-string form state and the
 * discriminated union every wardrobe write is parsed against, and it is
 * driven by `garmentFieldSpec` rather than by a hand-written switch. So the
 * assertions are driven the same way: what each category admits comes from
 * the schema here too, and a test that listed the fields per category would
 * be the fourth copy of the fact this mapping exists to stop.
 */

/**
 * The mapping used to be a function called `garmentFromFormValues`, which
 * ended in `garmentSchema.parse`. D-17 moved it into `garmentFormSchema` as
 * the transform ahead of a `.pipe()`, so the form's own submit path runs it
 * and a rejection is a field message rather than an unhandled rejection.
 * These assertions are about the behaviour, which did not change — so they
 * call the schema by the old name rather than being rewritten.
 */
function garmentFromFormValues(values: GarmentFormValues) {
  return garmentFormSchema.parse(values);
}

const BLANK: GarmentFormValues = {
  brand: "",
  name: "Test garment",
  category: "top",
  size: "",
  color: "",
  productUrl: "",
  layer: "",
  weight: "",
  fabric: "",
  windResistant: false,
  waterResistant: false,
};

describe("garmentFromFormValues carries exactly what the category admits", () => {
  it("keeps an attribute the category declares and drops one it does not", () => {
    // Every category, driven off the schema: the form always holds all
    // five attributes, and only the ones this variant declares may reach
    // the parsed garment. `strictObject` means a stray one is a parse
    // error rather than a quietly dropped field.
    for (const category of garmentCategoriesInOrder) {
      const declared = garmentFieldSpec.get(category) ?? new Set();
      const garment: Record<string, unknown> = garmentFromFormValues({
        ...BLANK,
        category,
        layer: "outer",
        weight: "heavy",
        fabric: "merino",
        windResistant: true,
        waterResistant: true,
      });

      for (const key of garmentAttributeKeys) {
        expect(
          Object.hasOwn(garment, key),
          `${category} ${Object.hasOwn(garment, key) ? "carries" : "drops"} ${key}`,
        ).toBe(declared.has(key));
      }
    }
  });

  it("treats an unchosen enum as absent, not as an empty string", () => {
    // The form's "" is "the runner has not said". Passing it through would
    // fail the enum, so a category that admits `layer` and a form that
    // leaves it blank must produce a garment with no `layer` at all.
    const garment: Record<string, unknown> = garmentFromFormValues({
      ...BLANK,
      category: "top",
      layer: "",
      weight: "",
      fabric: "",
    });
    expect(Object.hasOwn(garment, "layer")).toBe(false);
    expect(Object.hasOwn(garment, "weight")).toBe(false);
    expect(Object.hasOwn(garment, "fabric")).toBe(false);
  });

  it("keeps a boolean the category admits even when it is false", () => {
    // Unlike the enums, `false` is an answer: "this does not block wind"
    // is not the same as "nobody said". The garment inherits product
    // defaults where its own column is unset, so dropping `false` would
    // let a product's `true` win.
    const garment: Record<string, unknown> = garmentFromFormValues({
      ...BLANK,
      category: "top",
      windResistant: false,
      waterResistant: false,
    });
    expect(garment.windResistant).toBe(false);
    expect(garment.waterResistant).toBe(false);
  });

  it("trims the name and turns blank identity fields into nothing", () => {
    const garment = garmentFromFormValues({
      ...BLANK,
      name: "  Green L/S Crew  ",
      brand: " ".repeat(3),
      size: "  M  ",
      color: "",
      productUrl: "",
    });
    expect(garment.name).toBe("Green L/S Crew");
    expect(garment.brand).toBeUndefined();
    expect(garment.size).toBe("M");
    expect(garment.color).toBeUndefined();
    expect(garment.productUrl).toBeUndefined();
  });

  it("refuses a form the contract would refuse", () => {
    // The parse is the point: the previous version hand-built an object
    // typed as `Garment` that the schema never saw.
    expect(() =>
      garmentFromFormValues({ ...BLANK, name: " ".repeat(3) }),
    ).toThrow();
    expect(() =>
      garmentFromFormValues({ ...BLANK, productUrl: "not a url" }),
    ).toThrow();
  });
});

/**
 * A real stored row rather than a hand-built literal: `WardrobeItemRow` is
 * the table's own type, and writing one out by hand needs a cast the diff
 * auditor rejects — rightly, since the cast is what would let the fixture
 * drift from the schema.
 */
async function storedItem(
  garment: Parameters<typeof createItem>[2],
): Promise<WardrobeItemRow> {
  const userId = newUlid();
  return createItem(drizzle(env.DIALED_CORE), userId, garment, "manual");
}

const BRANDED = {
  category: "top",
  name: "Rover Half-Zip",
  brand: "Janji",
  size: "M",
  color: "Slate",
  productUrl: "https://janji.com/rover",
  layer: "mid",
} as const;

const EFFECTIVE: EffectiveAttributes = {
  weight: "mid",
  fabric: "merino",
  windResistant: true,
  waterResistant: false,
};

const NOTHING_KNOWN: EffectiveAttributes = {
  weight: undefined,
  fabric: undefined,
  windResistant: undefined,
  waterResistant: undefined,
};

describe("formValuesFromItem prefills from what the page actually shows", () => {
  it("fills the form from the item's own columns", async () => {
    const values = formValuesFromItem(await storedItem(BRANDED), EFFECTIVE);
    expect(values).toMatchObject({
      brand: "Janji",
      name: "Rover Half-Zip",
      category: "top",
      size: "M",
      color: "Slate",
      productUrl: "https://janji.com/rover",
      layer: "mid",
    });
  });

  it("uses the effective attributes, not the item's own empty columns", async () => {
    // The detail page shows product defaults where the item says nothing,
    // so an edit that started from the raw columns would silently clear
    // them on save.
    const values = formValuesFromItem(await storedItem(BRANDED), EFFECTIVE);
    expect(values.weight).toBe("mid");
    expect(values.fabric).toBe("merino");
    expect(values.windResistant).toBe(true);
    expect(values.waterResistant).toBe(false);
  });

  it("turns every absent value into the empty form state", async () => {
    // A tap-list piece: a name, a category, and nothing else.
    const bare = await storedItem({ category: "top", name: "Wind jacket" });

    expect(formValuesFromItem(bare, NOTHING_KNOWN)).toMatchObject({
      brand: "",
      size: "",
      color: "",
      productUrl: "",
      layer: "",
      weight: "",
      fabric: "",
      windResistant: false,
      waterResistant: false,
    });
  });

  it("round-trips a stored item back into a garment the contract accepts", async () => {
    const garment = garmentFromFormValues(
      formValuesFromItem(await storedItem(BRANDED), EFFECTIVE),
    );
    expect(garmentSchema.safeParse(garment).success).toBe(true);
    expect(garment.name).toBe("Rover Half-Zip");
  });
});
