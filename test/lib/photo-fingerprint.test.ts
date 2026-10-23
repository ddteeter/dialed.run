import { describe, expect, it } from "vitest";

import {
  digitDistances,
  FINGERPRINT_COLUMNS,
  FINGERPRINT_MATCH_DISTANCE,
  FINGERPRINT_ROWS,
  fingerprintOf,
  fingerprintOfGrid,
  HEX_DIGITS,
  isFingerprint,
} from "../../src/lib/photo-fingerprint";
import {
  bitsApart,
  copyOf,
  fingerprintOfBytes,
  sceneJpeg,
} from "../fixtures/scenes";

type Rgb = readonly [number, number, number];

const GREY: Rgb = [100, 100, 100];

/**
 * A 9 × 8 RGBA grid, all `GREY` but for the pixels named, by
 * `[row, column]`.
 */
function grid(pixels: readonly [number, number, Rgb][] = []): Uint8Array {
  const rgba = new Uint8Array(FINGERPRINT_COLUMNS * FINGERPRINT_ROWS * 4);
  for (let pixel = 0; pixel < FINGERPRINT_COLUMNS * FINGERPRINT_ROWS; pixel++) {
    rgba.set([...GREY, 255], pixel * 4);
  }
  for (const [row, column, rgb] of pixels) {
    rgba.set([...rgb, 255], (row * FINGERPRINT_COLUMNS + column) * 4);
  }
  return rgba;
}

describe("fingerprintOfGrid", () => {
  it("is all zeros for a flat grid: equal neighbours are not brighter", () => {
    expect(fingerprintOfGrid(grid())).toBe("0000000000000000");
  });

  it("puts the top-left pair in the most significant bit", () => {
    expect(fingerprintOfGrid(grid([[0, 0, [200, 200, 200]]]))).toBe(
      "8000000000000000",
    );
  });

  it("puts the bottom-right pair in the least significant bit", () => {
    // Column 7 against column 8: the last column is only ever a neighbour.
    expect(fingerprintOfGrid(grid([[7, 7, [200, 200, 200]]]))).toBe(
      "0000000000000001",
    );
  });

  it("reads the last column only as a neighbour", () => {
    // A brighter column 8 makes column 7 the darker of its pair: no bit.
    expect(fingerprintOfGrid(grid([[3, 8, [200, 200, 200]]]))).toBe(
      "0000000000000000",
    );
  });

  it("pads each row to two hex digits", () => {
    // Row 0's last pair only: 0x01, which would be "1" unpadded.
    expect(fingerprintOfGrid(grid([[0, 7, [200, 200, 200]]]))).toBe(
      "0100000000000000",
    );
  });

  it("sets a bit for every brighter pixel, in order along a row", () => {
    expect(
      fingerprintOfGrid(
        grid([
          [2, 0, [200, 200, 200]],
          [2, 2, [200, 200, 200]],
          [2, 4, [200, 200, 200]],
          [2, 6, [200, 200, 200]],
        ]),
      ),
    ).toBe("0000aa0000000000");
  });

  it("weighs red, green and blue by BT.601", () => {
    // Each pair is close enough that only the right weights order it.
    const fingerprint = fingerprintOfGrid(
      grid([
        // Pure red 255 (76 245) is darker than green 130 (76 310).
        [0, 0, [255, 0, 0]],
        [0, 1, [0, 130, 0]],
        // Red 98 (29 302) is brighter than pure blue 255 (29 070).
        [1, 0, [98, 0, 0]],
        [1, 1, [0, 0, 255]],
        // Blue 255 (29 070) is brighter than green 49 (28 763).
        [2, 0, [0, 0, 255]],
        [2, 1, [0, 49, 0]],
        // Grey 100 (100 000) is brighter than red 255 (76 245): all three
        // channels add up.
        [3, 0, [100, 100, 100]],
        [3, 1, [255, 0, 0]],
        // Green and blue together (58 700 + 11 400) outweigh red 230
        // (68 770); green alone would not.
        [4, 0, [0, 100, 100]],
        [4, 1, [230, 0, 0]],
      ]),
    );
    // Each row's first pair is the top bit of its byte, and every second
    // pixel is darker than the grey beside it.
    expect(fingerprint.slice(0, 10)).toBe("0080808080");
  });
});

describe("digitDistances", () => {
  it("counts the bits each digit differs from 0 in", () => {
    expect(digitDistances("0")).toBe("0112122312232334");
  });

  it("counts the bits each digit differs from f in", () => {
    expect(digitDistances("f")).toBe("4332322132212110");
  });

  it("agrees with a count of the XOR for every pair of digits", () => {
    const digits = Array.from({ length: 16 }, (_, value) =>
      HEX_DIGITS.charAt(value),
    );
    for (const digit of digits) {
      const row = digitDistances(digit);
      for (const [value, other] of digits.entries()) {
        expect(Number(row.charAt(value))).toBe(bitsApart(digit, other));
      }
    }
  });
});

describe("isFingerprint", () => {
  it("takes 16 lowercase hex digits", () => {
    expect(isFingerprint("0123456789abcdef")).toBe(true);
  });

  it.each([
    ["uppercase", "0123456789ABCDEF"],
    ["15 digits", "0123456789abcde"],
    ["17 digits", "0123456789abcdef0"],
    ["a non-hex digit", "0123456789abcdeg"],
    ["a leading extra", "x0123456789abcdef"],
    ["a trailing extra", "0123456789abcdefx"],
    ["SQL", "0' OR 1=1 --abcd"],
  ])("refuses %s", (_, value) => {
    expect(isFingerprint(value)).toBe(false);
  });
});

describe("fingerprintOf", () => {
  it("is the same for the same bytes", async () => {
    const bytes = await sceneJpeg(1);
    const fingerprint = await fingerprintOfBytes(bytes);
    expect(isFingerprint(fingerprint)).toBe(true);
    expect(await fingerprintOfBytes(bytes)).toBe(fingerprint);
  });

  it("is within the match distance of a smaller, re-encoded copy", async () => {
    const bytes = await sceneJpeg(1);
    const copy = await copyOf(bytes);
    expect(
      bitsApart(
        await fingerprintOfBytes(bytes),
        await fingerprintOfBytes(copy),
      ),
    ).toBeLessThanOrEqual(FINGERPRINT_MATCH_DISTANCE);
  });

  it("is beyond the match distance of a different picture", async () => {
    const one = await fingerprintOfBytes(await sceneJpeg(1));
    const two = await fingerprintOfBytes(await sceneJpeg(2));
    expect(bitsApart(one, two)).toBeGreaterThan(FINGERPRINT_MATCH_DISTANCE);
  });

  it("leaves the image it was given whole", async () => {
    const photon = await import("@cf-wasm/photon/workerd");
    const image = photon.PhotonImage.new_from_byteslice(await sceneJpeg(1));
    try {
      await fingerprintOf(image, photon);
      expect([image.get_width(), image.get_height()]).toStrictEqual([400, 300]);
    } finally {
      image.free();
    }
  });
});
