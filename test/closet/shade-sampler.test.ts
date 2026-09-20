import { describe, expect, it } from "vitest";

import {
  hexFromPixel,
  pixelAt,
  toHex,
} from "../../src/modules/closet/components/ShadeSheet";

/**
 * The two pure halves of §AH's sampler.
 *
 * Split out of `sampleAt` because a canvas is what makes the rest
 * unreachable from a test: with no 2d context every decision inside it
 * would be a mutant nothing could kill. These are the decisions.
 */
describe("pixelAt", () => {
  it("scales a fraction of the box to a pixel of the photo", () => {
    // The tap is measured against the rendered box and read against the
    // photo's natural size, which is the whole point — a photo shown at
    // 390px wide and stored at 1200px must be read at 1200.
    expect(pixelAt(0.5, 0.25, 1200, 800)).toEqual({ x: 600, y: 200 });
  });

  it("floors rather than rounds, so a pixel is the one under the finger", () => {
    expect(pixelAt(0.999, 0.001, 10, 10)).toEqual({ x: 9, y: 0 });
  });

  it("clamps the right and bottom edges back inside the photo", () => {
    // A tap on the exact edge gives a fraction of 1, and `1 * width` is
    // one pixel past the end — `getImageData` there reads transparent
    // black, so the runner would sample #000000 from a white jacket.
    expect(pixelAt(1, 1, 100, 50)).toEqual({ x: 99, y: 49 });
  });

  it("clamps a tap that lands outside the box at all", () => {
    // A pointer can leave the element between press and release.
    expect(pixelAt(-0.2, -3, 100, 50)).toEqual({ x: 0, y: 0 });
    expect(pixelAt(4, 9, 100, 50)).toEqual({ x: 99, y: 49 });
  });
});

describe("toHex", () => {
  it("writes six digits, lowercase", () => {
    expect(toHex(31, 42, 68)).toBe("#1f2a44");
  });

  it("pads a channel under 16, which is where a near-black pixel breaks", () => {
    // Unpadded this is `#0a11`, which is not a colour and fails the schema
    // that would store it.
    expect(toHex(0, 10, 17)).toBe("#000a11");
  });

  it("writes white and black in full", () => {
    expect(toHex(255, 255, 255)).toBe("#ffffff");
    expect(toHex(0, 0, 0)).toBe("#000000");
  });

  it("keeps the channels in red, green, blue order", () => {
    // A transposition is invisible on a grey and wrong on everything else.
    expect(toHex(1, 2, 3)).toBe("#010203");
  });
});

describe("hexFromPixel", () => {
  it("reads the first three channels and ignores alpha", () => {
    expect(hexFromPixel([31, 42, 68, 255])).toBe("#1f2a44");
  });

  it("answers nothing for a buffer too short to be a pixel", () => {
    // `getImageData` on a real canvas always answers four channels, so
    // this is the compiler's case rather than the browser's — and it is
    // reachable only because the buffer is the argument. A guard written
    // inside the canvas code would be a branch no input could produce.
    expect(hexFromPixel([])).toBeUndefined();
    expect(hexFromPixel([1])).toBeUndefined();
    expect(hexFromPixel([1, 2])).toBeUndefined();
  });

  it("takes a real Uint8ClampedArray too, which is what the canvas gives", () => {
    expect(hexFromPixel(Uint8ClampedArray.from([0, 10, 17, 255]))).toBe(
      "#000a11",
    );
  });
});
