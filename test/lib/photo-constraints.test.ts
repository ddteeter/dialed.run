import { describe, expect, it } from "vitest";

import {
  allowedPhotoTypes,
  photoAcceptAttribute,
  photoFormatWords,
  PHOTOS_STILL_HELD,
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

describe("PHOTOS_STILL_HELD", () => {
  it("says, in the owner's words, that the last ten photos are still being checked", () => {
    expect(PHOTOS_STILL_HELD).toBe(
      "Your last 10 photos are still being checked. You can add more once they're through.",
    );
  });
});
