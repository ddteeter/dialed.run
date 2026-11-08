import { describe, expect, it } from "vitest";

import {
  GARMENT_PHOTO_ROOT,
  garmentPhotoPrefix,
  photoKeyFor,
} from "../../src/lib/garment-photo-key";

describe("the garment photo key convention", () => {
  it("builds every prefix on one root, items/ (design 186's backup copies it)", () => {
    expect(GARMENT_PHOTO_ROOT).toBe("items/");
    expect(garmentPhotoPrefix("u1")).toBe("items/u1/");
    expect(photoKeyFor("u1", "i1")).toBe("items/u1/i1");
  });
});
