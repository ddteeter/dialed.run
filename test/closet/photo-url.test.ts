import { describe, expect, it } from "vitest";

import { photoUrlFor } from "../../src/modules/closet/photo-url";
import { wardrobeItem } from "../modules/closet-fixtures";

describe("photoUrlFor", () => {
  it("points at the card size, because both readers want the same one", () => {
    // Garment detail renders it and §AH's sampler reads a pixel out of it.
    // Two copies of this string is how one ends up on /full.
    expect(photoUrlFor(wardrobeItem({ id: "01ITEM", photoKey: "k" }))).toBe(
      "/closet/photo/01ITEM/card",
    );
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
