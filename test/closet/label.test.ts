import { describe, expect, it } from "vitest";
import { z } from "zod";

import { garmentLabel } from "../../src/modules/closet/label";

/**
 * The stored `brand` column is nullable and `null` is the value under
 * test, but `unicorn/no-null` rejects the literal and a cast is worse.
 * Parsed, not cast — which is the rule the cast would have broken anyway.
 */
const NO_BRAND = z.null().parse(JSON.parse("null"));

/**
 * What a garment is called on screen — one function because the grid and
 * the detail page had already drifted, and a screen reader heard a
 * different name than the heading showed.
 *
 * Its single condition has two independent reasons to skip the brand, and
 * only one of them was ever exercised: the mutant turning `||` into `&&`
 * kept every test green while making a generic item with a brand render as
 * "Nike Long sleeve base layer".
 */

describe("garmentLabel", () => {
  it("puts the brand in front of the name", () => {
    expect(
      garmentLabel({ name: "Pegasus 41", brand: "Nike", isGeneric: false }),
    ).toBe("Nike Pegasus 41");
  });

  it("drops the brand for a generic item, even when one is stored", () => {
    // A tap-list piece is generic. It can still carry a brand from a later
    // edit, and showing it would claim the placeholder is that product.
    expect(
      garmentLabel({
        name: "Long sleeve base layer",
        brand: "Nike",
        isGeneric: true,
      }),
    ).toBe("Long sleeve base layer");
  });

  it("uses the name alone when there is no brand", () => {
    expect(
      garmentLabel({ name: "Green L/S Crew", brand: NO_BRAND, isGeneric: false }),
    ).toBe("Green L/S Crew");
  });

  it("uses the name alone when it is generic and unbranded", () => {
    expect(
      garmentLabel({ name: "Wind jacket", brand: NO_BRAND, isGeneric: true }),
    ).toBe("Wind jacket");
  });
});
