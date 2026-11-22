import { describe, expect, it } from "vitest";

import {
  GARMENT_BRAND_MAX,
  GARMENT_NAME_MAX,
  garmentSchema,
  withoutHiddenControls,
} from "../../src/lib/contracts";
import { fileCorrectionSchema } from "../../src/lib/contracts/product-corrections";
import { takedownRequestSchema } from "../../src/lib/contracts/takedown";
import { newUlid } from "../../src/lib/ids";
import { nameIdentityInput } from "../../src/modules/onboarding/inputs";

const at = (...points: number[]): string => String.fromCodePoint(...points);

/**
Every character the strip takes out, one at a time.
*/
const HIDDEN = [
  0x20_2a, 0x20_2b, 0x20_2c, 0x20_2d, 0x20_2e, 0x20_66, 0x20_67, 0x20_68,
  0x20_69, 0x20_0e, 0x20_0f, 0x06_1c, 0x20_0b, 0x20_60, 0xfe_ff,
];

describe("a name's hidden controls", () => {
  it.each(HIDDEN.map((point) => [point.toString(16), point]))(
    "takes U+%s out",
    (_hex, point) => {
      expect(withoutHiddenControls(`Peg${at(point)}asus`)).toBe("Pegasus");
    },
  );

  it("takes every one out, wherever it sits", () => {
    expect(
      withoutHiddenControls(`${at(0x20_2e)}a${at(0x20_0b)}b${at(0xfe_ff)}`),
    ).toBe("ab");
  });

  it("keeps the joiners that scripts and emoji are spelt with", () => {
    const persian = `م${at(0x20_0c)}ی`;
    const family = `${at(0x1_f4_68)}${at(0x20_0d)}${at(0x1_f4_69)}`;
    expect(withoutHiddenControls(persian)).toBe(persian);
    expect(withoutHiddenControls(family)).toBe(family);
  });

  it("keeps the characters either side of the ranges", () => {
    const edges = at(0x20_29, 0x20_2f, 0x20_65, 0x20_6a, 0x20_0a, 0x20_10);
    expect(withoutHiddenControls(edges)).toBe(edges);
  });
});

describe("the fields that strip them", () => {
  it("a garment's name and brand", () => {
    const parsed = garmentSchema.parse({
      category: "shoes",
      name: `Pegasus ${at(0x20_2e)}41`,
      brand: `Ni${at(0x20_0b)}ke`,
    });
    expect(parsed.name).toBe("Pegasus 41");
    expect(parsed.brand).toBe("Nike");
  });

  it("refuses a name that is nothing but them", () => {
    expect(
      garmentSchema.safeParse({ category: "shoes", name: at(0x20_2e, 0x20_0b) })
        .success,
    ).toBe(false);
  });

  it("measures a name after they are out", () => {
    const name = `${"a".repeat(80)}${at(0x20_0b)}`;
    expect(garmentSchema.parse({ category: "shoes", name }).name).toHaveLength(
      80,
    );
  });

  it("onboarding's brand and model, before they are trimmed", () => {
    const parsed = nameIdentityInput.parse({
      brand: `${at(0x20_2e)} Smart${at(0x20_0b)}wool`,
      model: `250 Base${at(0x20_66)} ${at(0xfe_ff)}`,
    });
    expect(parsed).toStrictEqual({ brand: "Smartwool", model: "250 Base" });
  });

  it("refuses an onboarding brand or model that is nothing but them", () => {
    expect(nameIdentityInput.safeParse({ brand: at(0x20_2e) }).success).toBe(
      false,
    );
    expect(
      nameIdentityInput.safeParse({ brand: "S", model: at(0x20_0b, 0x20_60) })
        .success,
    ).toBe(false);
  });

  it("holds onboarding's brand and model to the garment's own limits", () => {
    expect(GARMENT_NAME_MAX).toBe(80);
    expect(GARMENT_BRAND_MAX).toBe(60);
    const model = "m".repeat(GARMENT_NAME_MAX);
    const brand = "b".repeat(GARMENT_BRAND_MAX);
    expect(nameIdentityInput.safeParse({ brand, model }).success).toBe(true);
    expect(
      nameIdentityInput.safeParse({ brand, model: `${model}m` }).success,
    ).toBe(false);
    expect(
      nameIdentityInput.safeParse({ brand: `${brand}b`, model }).success,
    ).toBe(false);
    expect(
      nameIdentityInput.parse({ brand, model: `${model}${at(0x20_0b)}` })
        .model,
    ).toHaveLength(GARMENT_NAME_MAX);
  });

  it("a name correction", () => {
    const parsed = fileCorrectionSchema.parse({
      productId: newUlid(),
      garmentId: newUlid(),
      idempotencyKey: newUlid(),
      field: "name",
      value: ` Pegasus${at(0x20_2e)} 41 `,
    });
    expect(parsed.value).toBe("Pegasus 41");
  });

  it("refuses a name correction that is nothing but them", () => {
    expect(
      fileCorrectionSchema.safeParse({
        productId: newUlid(),
        garmentId: newUlid(),
        idempotencyKey: newUlid(),
        field: "name",
        value: at(0x20_0e, 0x20_0f),
      }).success,
    ).toBe(false);
  });

  it("a removal request's signature", () => {
    const parsed = takedownRequestSchema.parse({
      email: "sam@example.com",
      signature: `${at(0x20_2e)} Sam Runner `,
      location: "https://dialed.run/feed/entry/01JABCDEFGHJKMNPQRSTVWXYZ0",
      description: "",
      isAttested: true,
      idempotencyKey: "01J1111111111111111111111B",
    });
    expect(parsed.signature).toBe("Sam Runner");
  });
});
