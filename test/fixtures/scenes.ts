/**
 * Pictures with something in them, for the fingerprint tests (design
 * 146). The shared fixtures are no use here: `tinyJpeg` is flat grey, and
 * `sample-photo.bin` is a fine diagonal pattern that averages to flat at
 * 9 × 8 — both are the picture a perceptual hash cannot tell apart from
 * any other flat picture.
 *
 * A scene is a two-way gradient with a few solid discs on it, placed by a
 * seeded generator, so seed 1 is always the same picture and seed 2 is
 * always a different one.
 */
import { fingerprintOf } from "../../src/lib/photo-fingerprint";

/**
A small linear congruential generator: the same seed, the same numbers.
*/
function seeded(seed: number): () => number {
  let state = seed;
  return () => {
    state = (state * 1_103_515_245 + 12_345) % 2_147_483_648;
    return state / 2_147_483_648;
  };
}

/**
The scene's RGBA pixels.
*/
function scenePixels(seed: number, width: number, height: number): Uint8Array {
  const random = seeded(seed);
  const discs = Array.from({ length: 6 }, () => ({
    x: random() * width,
    y: random() * height,
    r: (0.06 + random() * 0.25) * width,
    rgb: [random() * 255, random() * 255, random() * 255],
  }));
  const pixels = new Uint8Array(width * height * 4);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      let rgb = [(x / width) * 120, (y / height) * 120, 80];
      for (const disc of discs) {
        if (Math.hypot(x - disc.x, y - disc.y) < disc.r) rgb = disc.rgb;
      }
      const at = (y * width + x) * 4;
      pixels.set([...rgb.map((channel) => channel + random() * 20), 255], at);
    }
  }
  return pixels;
}

/**
The scene as a JPEG at `quality`.
*/
export async function sceneJpeg(
  seed: number,
  { width = 400, height = 300, quality = 92 } = {},
): Promise<Uint8Array> {
  const { PhotonImage } = await import("@cf-wasm/photon/workerd");
  const image = new PhotonImage(
    scenePixels(seed, width, height),
    width,
    height,
  );
  try {
    return image.get_bytes_jpeg(quality);
  } finally {
    image.free();
  }
}

/**
 * The same picture as somebody else's copy of it: decoded, shrunk to
 * `width` × `height`, and saved again at another quality — what a
 * download, a screenshot or a re-share does to it.
 */
export async function copyOf(
  bytes: Uint8Array,
  { width = 320, height = 240, quality = 70 } = {},
): Promise<Uint8Array> {
  const { PhotonImage, resize, SamplingFilter } =
    await import("@cf-wasm/photon/workerd");
  const decoded = PhotonImage.new_from_byteslice(bytes);
  const smaller = resize(decoded, width, height, SamplingFilter.Lanczos3);
  try {
    return smaller.get_bytes_jpeg(quality);
  } finally {
    smaller.free();
    decoded.free();
  }
}

/**
The fingerprint of an encoded picture, as an upload path takes it.
*/
export async function fingerprintOfBytes(bytes: Uint8Array): Promise<string> {
  const photon = await import("@cf-wasm/photon/workerd");
  const image = photon.PhotonImage.new_from_byteslice(bytes);
  try {
    return await fingerprintOf(image, photon);
  } finally {
    image.free();
  }
}

/**
 * How many bits two fingerprints differ in, counted on BigInts rather
 * than with the module's own lookup, so the two can disagree.
 */
export function bitsApart(a: string, b: string): number {
  let differing = BigInt(`0x${a}`) ^ BigInt(`0x${b}`);
  let bits = 0;
  while (differing > 0n) {
    bits += Number(differing & 1n);
    differing >>= 1n;
  }
  return bits;
}

/**
 * A fingerprint setting the lowest `bits` bits: a value with a known
 * count, for the edges of `DISTINCTIVE_BITS` (design 164).
 */
export function withBitsSet(bits: number): string {
  return ((1n << BigInt(bits)) - 1n).toString(16).padStart(16, "0");
}

/**
 * A picture with nothing in it, as a JPEG: one grey all over, which a
 * perceptual hash sees as no bits at all (design 164).
 */
export async function flatJpeg(): Promise<Uint8Array> {
  const { PhotonImage } = await import("@cf-wasm/photon/workerd");
  const width = 400;
  const height = 300;
  const image = new PhotonImage(
    new Uint8Array(width * height * 4).fill(128),
    width,
    height,
  );
  try {
    return image.get_bytes_jpeg(92);
  } finally {
    image.free();
  }
}

/**
Where a report would go: nowhere, since no path here reports.
*/
export function quiet(): void {
  // Sentry is not what these tests are about.
}
