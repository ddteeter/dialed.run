import { describe, expect, it } from "vitest";

import { photoUrlFor } from "../../src/modules/closet/photo-url";
import { wardrobeItem } from "../modules/closet-fixtures";

describe("photoUrlFor", () => {
  it("points at the card size, carrying the photo's version", () => {
    // Garment detail renders it and §AH's sampler reads a pixel out of it.
    // Two copies of this string is how one ends up on /full.
    expect(
      photoUrlFor(
        wardrobeItem({ id: "01ITEM", photoKey: "items/01USER/01ITEM/01V2" }),
      ),
    ).toBe("/closet/photo/01ITEM/card?v=01V2");
  });

  it("changes when the photo is replaced, so an immutable cache cannot serve the old one", () => {
    const before = photoUrlFor(
      wardrobeItem({ id: "01ITEM", photoKey: "items/u/01ITEM/01V1" }),
    );
    const after = photoUrlFor(
      wardrobeItem({ id: "01ITEM", photoKey: "items/u/01ITEM/01V2" }),
    );
    expect(after).not.toBe(before);
  });

  it("is same-origin, which is what keeps the sampler's canvas readable", () => {
    const url = photoUrlFor(wardrobeItem({ photoKey: "k" }));
    expect(url).toMatch(/^\//);
    expect(url).not.toMatch(/^https?:/);
  });

  it("answers nothing for a garment with no photo", () => {
    expect(photoUrlFor(wardrobeItem())).toBeUndefined();
  });
});
