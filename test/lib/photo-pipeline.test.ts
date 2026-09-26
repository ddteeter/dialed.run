import { describe, expect, it } from "vitest";

import {
  imageDimensions,
  photoRefusal,
  pixelBudgetRefusal,
  unreadablePhotoRefusal,
  maxDecodedPixels,
  photoLongEdge,
} from "../../src/lib/photo-pipeline";

/**
 * SAF-2's backstop: the size an image declares, read before anything
 * decodes it. Real encoder output for each format, from Photon, plus
 * hand-built headers for the packings Photon does not write.
 */

async function photon() {
  return import("@cf-wasm/photon/workerd");
}

/**
A real image of this size, encoded by Photon.
*/
async function encoded(
  width: number,
  height: number,
  as: "png" | "jpeg" | "webp",
): Promise<Uint8Array> {
  const { PhotonImage } = await photon();
  const pixels = new Uint8Array(width * height * 4).fill(200);
  const image = new PhotonImage(pixels, width, height);
  try {
    if (as === "png") return image.get_bytes();
    if (as === "jpeg") return image.get_bytes_jpeg(80);
    return image.get_bytes_webp();
  } finally {
    image.free();
  }
}

/**
Bytes from a list of numbers and strings, each string as ASCII.
*/
function bytesOf(...parts: readonly (number | string)[]): Uint8Array {
  const out: number[] = [];
  for (const part of parts) {
    if (typeof part === "number") out.push(part);
    else for (const char of part) out.push(char.codePointAt(0) ?? 0);
  }
  return new Uint8Array(out);
}

/**
A RIFF/WEBP container whose first chunk is `chunk`, then `body`.
*/
function webp(chunk: string, ...body: readonly number[]): Uint8Array {
  return bytesOf("RIFF", 0, 0, 0, 0, "WEBP", chunk, 0, 0, 0, 0, ...body);
}

describe("imageDimensions, from real encoder output", () => {
  it.each(["png", "jpeg", "webp"] as const)(
    "reads a %s's size without decoding it",
    async (format) => {
      expect(imageDimensions(await encoded(321, 123, format))).toStrictEqual({
        width: 321,
        height: 123,
      });
    },
  );
});

describe("imageDimensions, from hand-built headers", () => {
  it("reads a PNG's 32-bit size, high halves included", () => {
    const png = bytesOf(
      0x89,
      "PNG",
      0x0d,
      0x0a,
      0x1a,
      0x0a,
      0,
      0,
      0,
      13,
      "IHDR",
      0x00,
      0x01,
      0x00,
      0x02, // width 65538
      0x00,
      0x02,
      0x00,
      0x03, // height 131075
    );
    expect(imageDimensions(png)).toStrictEqual({
      width: 65_538,
      height: 131_075,
    });
  });

  it("walks a JPEG's segments to the frame, past markers that look like one", () => {
    const jpeg = bytesOf(
      0xff,
      0xd8,
      0xff,
      0xe1,
      0x00,
      0x04,
      0x12,
      0x34, // APP1, 2 bytes of payload
      0xff,
      0xc4,
      0x00,
      0x02, // DHT: in the SOF range, not a frame
      0xff,
      0xc8,
      0x00,
      0x02, // JPG: reserved, not a frame
      0xff,
      0xcc,
      0x00,
      0x02, // DAC: not a frame
      0xff,
      0xc2,
      0x00,
      0x11,
      0x08,
      0x0b,
      0xb8,
      0x0f,
      0xa0, // SOF2
    );
    expect(imageDimensions(jpeg)).toStrictEqual({ width: 4000, height: 3000 });
  });

  it.each([0xc0, 0xc1, 0xc3, 0xc5, 0xcf])(
    "takes marker %s as a frame",
    (marker) => {
      const jpeg = bytesOf(0xff, 0xd8, 0xff, marker, 0, 17, 8, 0, 2, 0, 3);
      expect(imageDimensions(jpeg)).toStrictEqual({ width: 3, height: 2 });
    },
  );

  it.each([0xbf, 0xd0])("does not take marker %s as a frame", (marker) => {
    const jpeg = bytesOf(0xff, 0xd8, 0xff, marker, 0, 17, 8, 0, 2, 0, 3);
    expect(imageDimensions(jpeg)).toBeUndefined();
  });

  it("gives up on a JPEG whose segments stop making sense", () => {
    expect(
      imageDimensions(bytesOf(0xff, 0xd8, 0x00, 0xc0, 0, 17, 8, 0, 2, 0, 3)),
    ).toBeUndefined();
    // Truncated before any frame.
    expect(imageDimensions(bytesOf(0xff, 0xd8))).toBeUndefined();
  });

  it("reads a lossy WebP's 14-bit size, ignoring the scale bits", () => {
    const lossy = webp(
      "VP8 ",
      0,
      0,
      0,
      0x9d,
      0x01,
      0x2a, // frame tag, start code
      0x41,
      0xc1, // width 321, scale bits set
      0x7b,
      0x40, // height 123, scale bits set
    );
    expect(imageDimensions(lossy)).toStrictEqual({ width: 321, height: 123 });
  });

  it("reads an extended WebP's 24-bit size", () => {
    const extended = webp(
      "VP8X",
      0,
      0,
      0,
      0, // flags
      0x0f,
      0x42,
      0x01, // width - 1 = 82447
      0x3f,
      0x0d,
      0x03, // height - 1 = 200000 - 1
    );
    expect(imageDimensions(extended)).toStrictEqual({
      width: 82_448,
      height: 200_000,
    });
  });

  it("reads a lossless WebP's widest size", () => {
    // Both 14-bit fields all ones: 16384 × 16384.
    const lossless = webp("VP8L", 0x2f, 0xff, 0xff, 0xff, 0x0f);
    expect(imageDimensions(lossless)).toStrictEqual({
      width: 16_384,
      height: 16_384,
    });
  });

  it("knows no other WebP chunk", () => {
    expect(imageDimensions(webp("ALPH", 1, 2, 3))).toBeUndefined();
  });

  it("refuses what is not an image it reads", () => {
    expect(imageDimensions(bytesOf("GIF89a", 1, 0, 1, 0))).toBeUndefined();
    expect(
      imageDimensions(bytesOf("RIFF", 0, 0, 0, 0, "WAVE")),
    ).toBeUndefined();
    expect(
      imageDimensions(bytesOf(0x89, "PNG", 0, 0, 0, 0, 0, 0, 0, 0, "IDAT")),
    ).toBeUndefined();
    expect(imageDimensions(new Uint8Array())).toBeUndefined();
  });
});

/**
A PNG header declaring this size.
*/
function pngOf(width: number, height: number): Uint8Array {
  return bytesOf(
    0x89,
    "PNG",
    0x0d,
    0x0a,
    0x1a,
    0x0a,
    0,
    0,
    0,
    13,
    "IHDR",
    (width >>> 24) & 0xff,
    (width >>> 16) & 0xff,
    (width >>> 8) & 0xff,
    width & 0xff,
    (height >>> 24) & 0xff,
    (height >>> 16) & 0xff,
    (height >>> 8) & 0xff,
    height & 0xff,
  );
}

describe("photoRefusal", () => {
  it("takes exactly the budget and refuses one pixel more", () => {
    expect(maxDecodedPixels).toBe(4096 * 4096);
    expect(photoRefusal(pngOf(4096, 4096))).toBeUndefined();
    expect(photoRefusal(pngOf(4097, 4096))).toBe(pixelBudgetRefusal);
    expect(photoRefusal(pngOf(4096, 4097))).toBe(pixelBudgetRefusal);
  });

  it("refuses D-3's case: a 12 MP-plus frame the browser should have shrunk", () => {
    expect(photoRefusal(pngOf(6000, 4000))).toBe(pixelBudgetRefusal);
  });

  it("refuses a header it cannot read, and an empty image", () => {
    expect(photoRefusal(new Uint8Array([1, 2, 3]))).toBe(
      unreadablePhotoRefusal,
    );
    expect(photoRefusal(pngOf(0, 10))).toBe(unreadablePhotoRefusal);
    expect(photoRefusal(pngOf(10, 0))).toBe(unreadablePhotoRefusal);
    expect(photoRefusal(pngOf(1, 1))).toBeUndefined();
  });

  it("scales in the browser to a 2048px long edge", () => {
    expect(photoLongEdge).toBe(2048);
  });
});

describe("the refusals' words", () => {
  it("say what to do, in the pipeline's own terms", () => {
    expect(pixelBudgetRefusal).toBe("Photo must be 16 megapixels or smaller.");
    expect(unreadablePhotoRefusal).toBe("Photo must be a JPG, PNG or WebP.");
  });
});
