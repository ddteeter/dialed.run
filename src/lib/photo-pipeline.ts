/**
 * The two pieces of the photo pipeline that are pure: fitting a size into a
 * box, and releasing a WASM image after use.
 *
 * In `lib/` rather than `closet/photos.ts`, where they were written, because
 * enrichment re-encodes a product image the same way a runner's photo is
 * re-encoded (PR #72 review) — and enrichment importing the closet's barrel
 * for them closed a cycle: `closet/service` enqueues enrichment, whose
 * consumer copies the image. Pure helpers with no bindings behind them are
 * what `lib/` is for; the R2 writes and the row updates stay in the modules.
 */

import { photoFormatWords } from "./photo-constraints";

/**
 * The size an image is stored at: itself, or scaled down so its longest
 * edge is `max`. Never scaled up.
 *
 * One expression rather than an early return, and that is a mutation-test
 * decision: the guard it replaced (`if (width <= max && height <= max)`)
 * had two equivalent mutants, because `<=` and `<` differ only when a side
 * equals `max`, and then the scale is exactly 1 either way. Clamping the
 * scale says the same thing with no branch to mutate.
 */
export function fitWithin(
  width: number,
  height: number,
  max: number,
): { width: number; height: number } {
  const scale = Math.min(1, max / Math.max(width, height));
  return {
    width: Math.max(1, Math.round(width * scale)),
    height: Math.max(1, Math.round(height * scale)),
  };
}

/**
 * Runs `use`, then hands the WASM image's memory back — whether `use`
 * returned or threw.
 *
 * One helper rather than two `try/finally` blocks, because a release is
 * the kind of thing that is invisible when it stops happening: nothing in
 * a test can see a leak, and nothing in production sees it either until an
 * isolate runs out of memory mid-upload. Written down once, it can at
 * least be asserted once.
 */
export async function withReleased<Image extends { free: () => void }, Result>(
  image: Image,
  use: (image: Image) => Promise<Result>,
): Promise<Result> {
  try {
    return await use(image);
  } finally {
    image.free();
  }
}

/**
 * The most pixels any stored photo may decode to (task 128 · SAF-2,
 * decision D-45, register R-3): 4096 × 4096.
 *
 * Photon decodes to RGBA, four bytes a pixel, so this is 64 MiB of decoded
 * image inside a 128 MB isolate — with room left for the upload itself
 * (up to 10 MB) and the re-encoded copy. R-3's case, a 10 MB JPEG decoding
 * to ~96 MB, is refused before it is decoded. The browser scales a picked
 * photo to a 2048px long edge first (`photoLongEdge`), so an honest upload
 * is a quarter of this; the cap is the backstop for everything else.
 */
export const maxDecodedPixels = 4096 * 4096;

/**
 * What a runner is told when a photo is over the budget — in the words of
 * the size refusal beside it ("Photo must be 10 MB or smaller."), and in
 * megapixels, the unit a phone's camera settings use.
 */
export const pixelBudgetRefusal = `Photo must be ${String(Math.floor(maxDecodedPixels / 1_000_000))} megapixels or smaller.`;

/**
 * The long edge the browser scales a picked photo down to before upload
 * (decision D-45).
 */
export const photoLongEdge = 2048;

export interface Dimensions {
  width: number;
  height: number;
}

/**
The byte at `at`, or 0 past the end — a short file reads as zeros.
*/
function byteAt(bytes: Uint8Array, at: number): number {
  return bytes[at] ?? 0;
}

/**
Big-endian 16-bit read.
*/
function u16be(bytes: Uint8Array, at: number): number {
  return byteAt(bytes, at) * 256 + byteAt(bytes, at + 1);
}

/**
Little-endian read of `length` bytes.
*/
function uintLe(bytes: Uint8Array, at: number, length: number): number {
  let value = 0;
  for (let index = length - 1; index >= 0; index -= 1) {
    value = value * 256 + byteAt(bytes, at + index);
  }
  return value;
}

function asciiAt(bytes: Uint8Array, at: number, length: number): string {
  return String.fromCodePoint(...bytes.subarray(at, at + length));
}

/**
 * JPEG's start-of-frame markers — the ones that carry the frame's size:
 * C0–CF, except C4 (Huffman tables), C8 (reserved) and CC (arithmetic
 * coding conditioning), which share the range and are not frames.
 */
const NOT_FRAMES: ReadonlySet<number> = new Set([0xc4, 0xc8, 0xcc]);

function isStartOfFrame(marker: number): boolean {
  return marker >= 0xc0 && marker <= 0xcf && !NOT_FRAMES.has(marker);
}

/**
 * A JPEG's size: walk the segments from the start until the frame header.
 * Every segment before it declares its own length, so this reads a few
 * hundred bytes of a 10 MB file and never the image data.
 */
function jpegDimensions(bytes: Uint8Array): Dimensions | undefined {
  let at = 2;
  while (byteAt(bytes, at) === 0xff) {
    const marker = byteAt(bytes, at + 1);
    if (isStartOfFrame(marker)) {
      return { height: u16be(bytes, at + 5), width: u16be(bytes, at + 7) };
    }
    at += 2 + u16be(bytes, at + 2);
  }
  return undefined;
}

/**
 * A WebP's size, from whichever of its three first chunks it has: lossy
 * (`VP8 `), lossless (`VP8L`) or extended (`VP8X`). Each packs the size its
 * own way (the WebP container and bitstream specs).
 */
const WEBP_SIZES: Readonly<Record<string, (bytes: Uint8Array) => Dimensions>> =
  {
    // 14 bits each, after the 3-byte start code; the top 2 bits are scale.
    "VP8 ": (bytes) => ({
      width: uintLe(bytes, 26, 2) % 0x40_00,
      height: uintLe(bytes, 28, 2) % 0x40_00,
    }),
    // 14 bits of width-1 then 14 of height-1, after the 0x2f signature.
    VP8L: (bytes) => {
      const bits = uintLe(bytes, 21, 4);
      return {
        width: (bits % 0x40_00) + 1,
        height: (Math.floor(bits / 0x40_00) % 0x40_00) + 1,
      };
    },
    // 24 bits each of width-1 and height-1, after 4 bytes of flags.
    VP8X: (bytes) => ({
      width: uintLe(bytes, 24, 3) + 1,
      height: uintLe(bytes, 27, 3) + 1,
    }),
  };

/**
 * The size an image declares in its header, without decoding it — or
 * undefined when the bytes are not a JPEG, PNG or WebP this can read.
 *
 * Read from the bytes' own signature, never the declared content type: a
 * client names the type, and the budget must hold whatever it says.
 */
export function imageDimensions(bytes: Uint8Array): Dimensions | undefined {
  if (u16be(bytes, 0) === 0xff_d8) return jpegDimensions(bytes);
  if (asciiAt(bytes, 1, 3) === "PNG" && asciiAt(bytes, 12, 4) === "IHDR") {
    return {
      width: u16be(bytes, 16) * 0x1_00_00 + u16be(bytes, 18),
      height: u16be(bytes, 20) * 0x1_00_00 + u16be(bytes, 22),
    };
  }
  if (asciiAt(bytes, 0, 4) !== "RIFF" || asciiAt(bytes, 8, 4) !== "WEBP") {
    return undefined;
  }
  return WEBP_SIZES[asciiAt(bytes, 12, 4)]?.(bytes);
}

/**
 * What a runner is told when the bytes are not an image the pipeline
 * reads, whatever type the upload claimed.
 */
export const unreadablePhotoRefusal = `Photo must be a ${photoFormatWords}.`;

/**
 * Why these bytes may not be decoded, or undefined when they may: the
 * header must be readable, declare a picture, and declare no more than
 * `maxDecodedPixels`. Asked before Photon sees the bytes, so an oversized
 * image is refused having cost a header read.
 */
export function photoRefusal(bytes: Uint8Array): string | undefined {
  const size = imageDimensions(bytes);
  if (size === undefined || size.width === 0 || size.height === 0) {
    return unreadablePhotoRefusal;
  }
  return size.width * size.height > maxDecodedPixels
    ? pixelBudgetRefusal
    : undefined;
}
