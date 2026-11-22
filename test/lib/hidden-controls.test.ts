import { describe, expect, it } from "vitest";

import { garmentSchema, withoutHiddenControls } from "../../src/lib/contracts";
import { takedownRequestSchema } from "../../src/lib/contracts/takedown";

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
