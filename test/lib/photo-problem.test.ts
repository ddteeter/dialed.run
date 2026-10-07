import { describe, expect, it } from "vitest";

import { photoProblem } from "../../src/lib/photo-constraints";

/**
 * The refusal every photo-taking screen asks before it keeps a file: A2's
 * well and W3's Pick another — the one the upload routes would turn away.
 */

const CAP = 10 * 1024 * 1024;

function photo(bytes: number, type: string): File {
  const body = new Uint8Array(bytes);
  return new File([body], "photo", { type });
}

describe("photoProblem", () => {
  it("passes a photo of an accepted type under the cap", () => {
    expect(photoProblem(photo(10, "image/jpeg"))).toBeUndefined();
  });

  it("names the accepted types for one it does not take", () => {
    expect(photoProblem(photo(1, "image/heic"))).toBe(
      "Photos must be JPG, PNG or WebP.",
    );
  });

  it("names the cap for one that is over it, and takes one exactly at it", () => {
    expect(photoProblem(photo(CAP + 1, "image/png"))).toBe(
      "That photo is over 10 MB. Pick a smaller one.",
    );
    expect(photoProblem(photo(CAP, "image/png"))).toBeUndefined();
  });
});
