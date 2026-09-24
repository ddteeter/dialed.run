import { describe, expect, it } from "vitest";

import {
  allowedPhotoTypes,
  photoAcceptAttribute,
  photoFormatWords,
} from "../../src/lib/photo-constraints";

/**
 * What a photo well tells a runner it takes, read from what the server
 * accepts. Round 22's well draws "JPG, PNG or HEIC"; HEIC is not accepted,
 * so the words come from the tuple rather than the drawing.
 */
describe("photoFormatWords", () => {
  it("names every accepted type, in order, as a runner reads it", () => {
    expect(photoFormatWords).toBe("JPG, PNG or WebP");
  });

  it("covers the same types the input filters by", () => {
    expect(photoAcceptAttribute).toBe(allowedPhotoTypes.join(","));
  });
});
