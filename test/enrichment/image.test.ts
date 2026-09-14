import { describe, expect, it, vi } from "vitest";

import { env } from "../../src/env";
import { newUlid } from "../../src/lib/ids";
import { maxPhotoBytes } from "../../src/lib/photo-constraints";
import {
  copyProductImage,
  productImageKey,
} from "../../src/modules/enrichment/image";

/**
 * The image URL comes off a page we do not control, so this is the same
 * kind of boundary the page fetch is: a host check, a type check against
 * the *response* rather than the URL, and a cap. The bytes land in the real
 * MEDIA bucket, so every assertion reads them back out of it.
 */

const IMAGE_URL = "https://cdn.example.com/products/tee.jpg";
const FETCHED_AT = 1_757_700_000_000;
const BYTES = new Uint8Array([1, 2, 3, 4]);

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
const untyped: typeof fetch = () => Promise.resolve(new Response(BYTES));

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
  it("stores the bytes and says they are an image", async () => {
    const productId = newUlid();
    const key = await copyProductImage(
      productId,
      IMAGE_URL,
      serving(BYTES, "image/jpeg"),
      FETCHED_AT,
    );

    expect(key).toBe(productImageKey(productId, FETCHED_AT));
    const stored = await env.MEDIA.get(key ?? "");
    expect(new Uint8Array(await (stored?.arrayBuffer() ?? new ArrayBuffer(0))))
      .toStrictEqual(BYTES);
    // Without the type a browser downloads the image instead of showing it.
    expect(stored?.httpMetadata?.contentType).toBe("image/jpeg");
  });

  it("asks for the types it can store", async () => {
    const fetchImpl = serving(BYTES, "image/png");
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
    const fetchImpl = serving(BYTES, "image/jpeg");
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
        serving(BYTES, "image/jpeg"),
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
    // `IMAGE/WEBP ; charset=binary` is a webp. A literal comparison
    // rejects a perfectly good image, and each of the three — the
    // parameter, the space before it, the case — is a separate way to get
    // that wrong.
    const productId = newUlid();
    const key = await copyProductImage(
      productId,
      IMAGE_URL,
      serving(BYTES, "IMAGE/WEBP ; charset=binary"),
      FETCHED_AT,
    );
    const stored = await env.MEDIA.get(key ?? "");
    expect(stored?.httpMetadata?.contentType).toBe("image/webp");
  });

  it("stores a type that has no parameters at all", async () => {
    // The other side of the cut: a bare `image/png` must survive it whole.
    const productId = newUlid();
    const key = await copyProductImage(
      productId,
      IMAGE_URL,
      serving(BYTES, "image/png"),
      FETCHED_AT,
    );
    const stored = await env.MEDIA.get(key ?? "");
    expect(stored?.httpMetadata?.contentType).toBe("image/png");
  });

  it("refuses an image past the cap, and stores nothing", async () => {
    const productId = newUlid();
    const oversized = new Uint8Array(maxPhotoBytes + 1);
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

  it("stores an image of exactly the cap", async () => {
    // The cap is a maximum, not one short of it.
    const productId = newUlid();
    const key = await copyProductImage(
      productId,
      IMAGE_URL,
      serving(new Uint8Array(maxPhotoBytes), "image/webp"),
      FETCHED_AT,
    );
    const stored = await env.MEDIA.get(key ?? "");
    expect(stored?.size).toBe(maxPhotoBytes);
  });
});
