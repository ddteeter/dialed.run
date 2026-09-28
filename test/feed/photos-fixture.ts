/**
 * Real image bytes for the photo paths, now that every stored photo is
 * decoded and re-encoded (task 128 · SAF-1): three made-up bytes no longer
 * reach storage, because Photon cannot decode them and the pixel budget
 * cannot read their header.
 */

/**
A small grey JPEG, encoded by Photon.
*/
export async function tinyJpeg(width = 64, height = 48): Promise<Uint8Array> {
  const { PhotonImage } = await import("@cf-wasm/photon/workerd");
  const image = new PhotonImage(
    new Uint8Array(width * height * 4).fill(128),
    width,
    height,
  );
  try {
    return image.get_bytes_jpeg(80);
  } finally {
    image.free();
  }
}

/**
The bytes of an ASCII string.
*/
function ascii(text: string): number[] {
  return [...new TextEncoder().encode(text)];
}

/**
 * Where a phone would say it was: the string planted in the fixture's
 * EXIF, so `hasMetadata` can look for it in what comes back.
 */
const PLANTED_GPS = "GPS 44.9778N 93.2650W";

/**
 * A JPEG carrying an EXIF segment with a GPS IFD — what a phone photo taken
 * at home looks like to the server. The APP1 segment goes straight after
 * the start-of-image marker, where cameras put it; decoders skip it, so the
 * image is still a valid JPEG of the same size.
 */
export async function jpegWithGps(): Promise<Uint8Array> {
  const jpeg = await tinyJpeg();
  const tiff = [
    // Big-endian TIFF header, IFD0 at offset 8.
    ...ascii("MM"),
    0x00,
    0x2a,
    0x00,
    0x00,
    0x00,
    0x08,
    // IFD0: one entry, GPSInfo (0x8825) -> the GPS IFD at offset 26.
    0x00,
    0x01,
    0x88,
    0x25,
    0x00,
    0x04,
    0x00,
    0x00,
    0x00,
    0x01,
    0x00,
    0x00,
    0x00,
    0x1a,
    0x00,
    0x00,
    0x00,
    0x00,
    // GPS IFD: one entry, GPSLatitudeRef "N".
    0x00,
    0x01,
    0x00,
    0x01,
    0x00,
    0x02,
    0x00,
    0x00,
    0x00,
    0x02,
    ...ascii("N"),
    0x00,
    0x00,
    0x00,
    0x00,
    0x00,
    0x00,
    0x00,
    ...ascii(PLANTED_GPS),
  ];
  const payload = [...ascii("Exif"), 0x00, 0x00, ...tiff];
  const length = payload.length + 2;
  const app1 = [0xff, 0xe1, length >> 8, length & 0xff, ...payload];
  return new Uint8Array([...jpeg.subarray(0, 2), ...app1, ...jpeg.subarray(2)]);
}

/**
Whether these bytes carry an EXIF segment or the planted location.
*/
export function hasMetadata(bytes: Uint8Array): boolean {
  const text = new TextDecoder("latin1").decode(bytes);
  return text.includes("Exif") || text.includes(PLANTED_GPS);
}

/**
 * A JPEG header that claims `width` × `height` and has no image after it —
 * enough for the pixel budget to read, and nothing a decoder could decode,
 * so a refusal that names the budget proves the bytes were never decoded.
 */
export function oversizedJpegHeader(width: number, height: number): Uint8Array {
  return new Uint8Array([
    0xff,
    0xd8,
    0xff,
    0xc0,
    0x00,
    0x11,
    0x08,
    height >> 8,
    height & 0xff,
    width >> 8,
    width & 0xff,
    0x03,
  ]);
}
