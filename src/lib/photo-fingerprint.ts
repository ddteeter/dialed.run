/**
 * A photo's perceptual hash (D-142, design 146): what lets the takedown
 * review find copies of a reported image that are not byte-identical.
 *
 * **dHash, 64 bits.** The image is shrunk to 9 × 8 and each pixel's
 * brightness is compared with its right-hand neighbour: one bit per pair,
 * eight pairs a row, eight rows. A re-encode, a resize or a change of
 * format moves a few bits at most, because none of them changes which of
 * two neighbouring patches is brighter; a different picture moves dozens.
 * Measured in design 146: 0–5 bits for copies, 12+ between pictures.
 *
 * Pure apart from the Photon calls, which the caller passes in: both
 * upload paths already hold the decoded image, and importing the WASM
 * module here would instantiate it for every importer.
 */
import type * as Photon from "@cf-wasm/photon/workerd";
import { z } from "zod";

import { withReleased } from "./photo-pipeline";

/**
The grid the image is shrunk to: one column more than bits a row, so every bit has a right-hand neighbour.
*/
export const FINGERPRINT_COLUMNS = 9;
export const FINGERPRINT_ROWS = 8;

/**
 * The most bits two fingerprints may differ by and still be the same
 * picture. Copies measured 0–5, different pictures 12 or more (design
 * 146), so 8 sits in the gap with room on the copy side, where a missed
 * copy is the costlier mistake.
 */
export const FINGERPRINT_MATCH_DISTANCE = 8;

/**
 * Brightness, from ITU-R BT.601's weights in thousandths, so the sum is
 * an integer and two runtimes cannot round it differently.
 */
function luma(rgba: Uint8Array, pixel: number): number {
  const at = pixel * 4;
  return (
    299 * (rgba[at] ?? 0) +
    587 * (rgba[at + 1] ?? 0) +
    114 * (rgba[at + 2] ?? 0)
  );
}

/**
 * The fingerprint of a 9 × 8 RGBA grid, as 16 lowercase hex characters,
 * most significant bit first: row by row, left to right, a bit is 1 when
 * a pixel is brighter than the one to its right.
 */
export function fingerprintOfGrid(rgba: Uint8Array): string {
  let hex = "";
  for (let row = 0; row < FINGERPRINT_ROWS; row += 1) {
    let byte = 0;
    for (let column = 0; column < FINGERPRINT_COLUMNS - 1; column += 1) {
      const pixel = row * FINGERPRINT_COLUMNS + column;
      const brighter = luma(rgba, pixel) > luma(rgba, pixel + 1) ? 1 : 0;
      byte = byte * 2 + brighter;
    }
    hex += byte.toString(16).padStart(2, "0");
  }
  return hex;
}

/**
 * The fingerprint of a decoded image. The image itself is left as it
 * was; the 9 × 8 copy is released whatever happens.
 */
export async function fingerprintOf(
  image: Photon.PhotonImage,
  photon: Pick<typeof Photon, "resize" | "SamplingFilter">,
): Promise<string> {
  return withReleased(
    photon.resize(
      image,
      FINGERPRINT_COLUMNS,
      FINGERPRINT_ROWS,
      photon.SamplingFilter.Triangle,
    ),
    (grid) => Promise.resolve(fingerprintOfGrid(grid.get_raw_pixels())),
  );
}

/**
 * How many bits are set in a hex digit's value: the per-digit share of a
 * distance. Indexed by the digit's value, 0–15.
 */
const BITS_SET = [0, 1, 1, 2, 1, 2, 2, 3, 1, 2, 2, 3, 2, 3, 3, 4] as const;

/**
 * The hex digits in value order — `HEX_DIGITS.indexOf(d)` is d's value.
 */
export const HEX_DIGITS = "0123456789abcdef";

/**
 * For one digit of a fingerprint, the bits a stored digit differs by, as
 * a 16-character string indexed by the stored digit's value: character
 * `v` is how many bits `v` and `digit` differ in.
 *
 * This is what lets SQLite measure a distance it has no operator for
 * (design 146): one `substr` of this string per digit, summed.
 */
export function digitDistances(digit: string): string {
  const value = HEX_DIGITS.indexOf(digit);
  return Array.from({ length: HEX_DIGITS.length }, (_, other) =>
    String(BITS_SET[value ^ other]),
  ).join("");
}

/**
 * A fingerprint as this module writes it: exactly 16 lowercase hex
 * digits. The copy search spells one into SQL digit by digit, so it reads
 * them back through this.
 */
export const fingerprintSchema = z.string().regex(/^[0-9a-f]{16}$/);
