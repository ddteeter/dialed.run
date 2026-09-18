import { describe, expect, it, vi } from "vitest";

import { env } from "../../src/env";
import { newUlid } from "../../src/lib/ids";
import { maxPhotoBytes } from "../../src/lib/photo-constraints";
import { PageFetchError } from "../../src/modules/enrichment/bounds";
import {
  copyProductImage,
  productImageKey,
} from "../../src/modules/enrichment/image";
// The closet's 4000x3000 synthetic JPEG, loaded as raw bytes — see
// `test/closet/photos.test.ts` for why it is a `.bin`.
import samplePhotoBytes from "../fixtures/sample-photo.bin";

/**
 * The image URL comes off a page we do not control, so this is the same
 * kind of boundary the page fetch is: a host check, a type check against
 * the *response* rather than the URL, a cap — and then a decode, so what
 * lands in R2 is pixels we re-encoded and never the shop's bytes. The
 * bytes land in the real MEDIA bucket, so every assertion reads them back
 * out of it.
 */

const IMAGE_URL = "https://cdn.example.com/products/tee.jpg";
const FETCHED_AT = 1_757_700_000_000;
const PHOTO = new Uint8Array(samplePhotoBytes);
const NOT_AN_IMAGE = new Uint8Array([1, 2, 3, 4]);

/**
The RIFF/WEBP container header: what a re-encode must begin with.
*/
function isWebp(bytes: Uint8Array): boolean {
  const ascii = (from: number, to: number) =>
    String.fromCodePoint(...bytes.slice(from, to));
  return ascii(0, 4) === "RIFF" && ascii(8, 12) === "WEBP";
}

function serving(
  body: BodyInit,
  contentType: string,
  status = 200,
): ReturnType<typeof vi.fn<typeof fetch>> {
  const impl: typeof fetch = () =>
    Promise.resolve(
      new Response(body, { status, headers: { "content-type": contentType } }),
    );
  return vi.fn(impl);
}

/**
A 200 with bytes and no content-type at all — what a bare file server sends.
*/
const untyped: typeof fetch = () => Promise.resolve(new Response(PHOTO));

async function storedBytes(key: string | undefined): Promise<Uint8Array> {
  const stored = await env.MEDIA.get(key ?? "");
  return new Uint8Array(await (stored?.arrayBuffer() ?? new ArrayBuffer(0)));
}

describe("productImageKey", () => {
  it("files an image under its product, beside that product's snapshots", () => {
    expect(productImageKey("prod_123", FETCHED_AT)).toBe(
      "products/prod_123/image-1757700000000",
    );
  });

  it("gives two copies of one product two keys", () => {
    expect(productImageKey("p", 1)).not.toBe(productImageKey("p", 2));
  });
});

describe("copyProductImage", () => {
  it("stores a re-encode of the image, never the bytes the shop served", async () => {
    // A decode keeps pixels and nothing else: metadata, an appended second
    // file, a container the header lied about — none of it survives into
    // an object that will one day be served to a runner (PR #72 review).
    const productId = newUlid();
    const key = await copyProductImage(
      productId,
      IMAGE_URL,
      serving(PHOTO, "image/jpeg"),
      FETCHED_AT,
    );

    expect(key).toBe(productImageKey(productId, FETCHED_AT));
    const bytes = await storedBytes(key);
    expect(isWebp(bytes)).toBe(true);
    expect(bytes).not.toStrictEqual(PHOTO);
    // Without the type a browser downloads the image instead of showing it
    // — and it is the re-encode's type, whatever the shop's was.
    const stored = await env.MEDIA.get(key ?? "");
    expect(stored?.httpMetadata?.contentType).toBe("image/webp");
  });

  it("bounds the stored image to the closet's full size", async () => {
    // The fixture is 4000 wide; 1600 is the longest edge anything renders.
    // Photon writes lossless WebP, whose header carries the width at a
    // fixed offset, so the stored object says so itself.
    const key = await copyProductImage(
      newUlid(),
      IMAGE_URL,
      serving(PHOTO, "image/jpeg"),
      FETCHED_AT,
    );
    const bytes = await storedBytes(key);
    // Lossless WebP: a "VP8L" chunk, a signature byte, then 14 bits of
    // width minus one, little-endian.
    expect(String.fromCodePoint(...bytes.slice(12, 16))).toBe("VP8L");
    const width = (((bytes[22] ?? 0) << 8) | (bytes[21] ?? 0)) & 0x3f_ff;
    expect(width + 1).toBe(1600);
  });

  it("refuses bytes the decoder rejects, whatever the header claimed", async () => {
    // `image/jpeg` is the server's claim; the decoder is the authority. A
    // challenge page or a stray file served with an image type must not
    // become the product's picture.
    const productId = newUlid();
    let failure: unknown;
    try {
      await copyProductImage(
        productId,
        IMAGE_URL,
        serving(NOT_AN_IMAGE, "image/jpeg"),
        FETCHED_AT,
      );
    } catch (error) {
      failure = error;
    }
    expect(failure).toBeInstanceOf(PageFetchError);
    if (!(failure instanceof PageFetchError)) throw new Error("unreachable");
    expect(failure.message).toMatch(/could not be decoded/u);
    // The decoder's own complaint rides along, for the report.
    expect(failure.cause).toBeDefined();
    expect(await env.MEDIA.get(productImageKey(productId, FETCHED_AT))).toBeNull();
  });

  it("asks for the types it can store", async () => {
    const fetchImpl = serving(PHOTO, "image/png");
    await copyProductImage(newUlid(), IMAGE_URL, fetchImpl, FETCHED_AT);
    const init = fetchImpl.mock.calls[0]?.[1];
    expect(new Headers(init?.headers).get("accept")).toBe(
      "image/jpeg,image/png,image/webp",
    );
    expect(init?.signal).toBeInstanceOf(AbortSignal);
  });

  it("refuses an image on a private or local host", async () => {
    // A shop could point og:image at an internal address; the page fetch
    // refuses that and so must this.
    const fetchImpl = serving(PHOTO, "image/jpeg");
    for (const url of [
      "https://localhost/tee.jpg",
      "https://127.0.0.1/tee.jpg",
      "https://169.254.169.254/latest/meta-data",
    ]) {
      await expect(
        copyProductImage(newUlid(), url, fetchImpl, FETCHED_AT),
        url,
      ).rejects.toThrow(/Refusing an image URL/u);
    }
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("refuses a URL it cannot parse at all", async () => {
    await expect(
      copyProductImage(
        newUlid(),
        "not a url",
        serving(PHOTO, "image/jpeg"),
        FETCHED_AT,
      ),
    ).rejects.toThrow(/Refusing an image URL/u);
  });

  it("reports the status when the image is not served", async () => {
    await expect(
      copyProductImage(
        newUlid(),
        IMAGE_URL,
        serving("gone", "text/html", 404),
        FETCHED_AT,
      ),
    ).rejects.toThrow(/Image returned 404/u);
  });

  it("refuses a response that is not an image, whatever the URL ended in", async () => {
    // The `.jpg` is the shop's claim; the header is the server's. A
    // challenge page served at an image URL is HTML, and storing it would
    // put a login screen in the product's picture.
    await expect(
      copyProductImage(
        newUlid(),
        IMAGE_URL,
        serving("<html>nope</html>", "text/html"),
        FETCHED_AT,
      ),
    ).rejects.toThrow(/Image was text\/html/u);
  });

  it("refuses a response with no type at all", async () => {
    await expect(
      copyProductImage(newUlid(), IMAGE_URL, vi.fn(untyped), FETCHED_AT),
    ).rejects.toThrow(/Image was untyped/u);
  });

  it("reads the type without its parameters, its padding, or its case", async () => {
    // `IMAGE/JPEG ; charset=binary` is a jpeg. A literal comparison
    // rejects a perfectly good image, and each of the three — the
    // parameter, the space before it, the case — is a separate way to get
    // that wrong.
    const key = await copyProductImage(
      newUlid(),
      IMAGE_URL,
      serving(PHOTO, "IMAGE/JPEG ; charset=binary"),
      FETCHED_AT,
    );
    expect(isWebp(await storedBytes(key))).toBe(true);
  });

  it("refuses an image past the cap before decoding it, and stores nothing", async () => {
    // The cap runs on the bytes that arrived and ahead of the decode: a
    // decode is the expensive step (D-3), and a JPEG that is real up to
    // the cap and padded past it must not reach it.
    const productId = newUlid();
    const oversized = new Uint8Array(maxPhotoBytes + 1);
    oversized.set(PHOTO);
    await expect(
      copyProductImage(
        productId,
        IMAGE_URL,
        serving(oversized, "image/jpeg"),
        FETCHED_AT,
      ),
    ).rejects.toThrow(/exceeded/u);
    expect(await env.MEDIA.get(productImageKey(productId, FETCHED_AT))).toBeNull();
  });

  it("accepts an image of exactly the cap", async () => {
    // The cap is a maximum, not one short of it. The fixture padded to the
    // cap is still the fixture to a JPEG decoder, which stops at the end
    // marker, so the boundary is reachable with a real image.
    const exact = new Uint8Array(maxPhotoBytes);
    exact.set(PHOTO);
    const key = await copyProductImage(
      newUlid(),
      IMAGE_URL,
      serving(exact, "image/jpeg"),
      FETCHED_AT,
    );
    expect(isWebp(await storedBytes(key))).toBe(true);
  });
});
