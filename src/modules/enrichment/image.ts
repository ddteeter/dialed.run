import { env } from "../../env";
import {
  allowedPhotoTypes,
  isAllowedPhotoType,
  maxPhotoBytes,
} from "../../lib/photo-constraints";
import { PageFetchError } from "./bounds";
import { isBlockedHost } from "./fetch-page";

/**
 * The product's primary image, copied into R2 so the product page does not
 * depend on a shop's CDN (packet §4).
 *
 * **The URL comes off a page we do not control**, so it gets the same
 * treatment the page fetch gets: https only (already guaranteed — the
 * contract parses it with `httpsUrlSchema`), no private or local host, a
 * timeout, and a cap. The type is checked against the *response*, not the
 * URL's extension, because the extension is the shop's claim and the header
 * is the server's.
 *
 * Reuses `lib/photo-constraints` rather than inventing a second answer to
 * "what is an image here": entry photos and product images are the same
 * bytes in the same bucket, and two lists would drift.
 */

const TIMEOUT_MS = 10_000;

export function productImageKey(productId: string, fetchedAt: number): string {
  return `products/${productId}/image-${String(fetchedAt)}`;
}

/**
 * The image, or nothing when the shop will not serve one we can use.
 *
 * **Nothing, rather than a throw.** A product whose image 404s is still a
 * product with a composition, and the page it came from is already stored.
 * Failing the job over the picture would throw away the text — so this
 * reports and gives up, which is law 5 applied inside the consumer rather
 * than at its edge.
 */
export async function copyProductImage(
  productId: string,
  imageUrl: string,
  fetchImpl: typeof fetch,
  fetchedAt: number,
): Promise<string | undefined> {
  const url = URL.parse(imageUrl);
  // The contract's `httpsUrlSchema` has already refused anything but https,
  // so the host is the only thing left to check — and it is the one that
  // matters, since a shop could point `og:image` at a private address.
  if (url === null || isBlockedHost(url.hostname)) {
    throw new PageFetchError(`Refusing an image URL: ${imageUrl}`);
  }

  const response = await fetchImpl(url.href, {
    signal: AbortSignal.timeout(TIMEOUT_MS),
    headers: { accept: allowedPhotoTypes.join(",") },
  });
  if (!response.ok) {
    throw new PageFetchError(`Image returned ${String(response.status)}`);
  }

  // Cut at the first ";": a server may answer `image/jpeg; charset=binary`,
  // and the parameter is not part of the type.
  //
  // `indexOf`/`slice` rather than `split(";", 1)[0]`, and that is not a
  // style preference. Under `noUncheckedIndexedAccess` the index is
  // `string | undefined`, so the split form needs an optional chain and an
  // undefined check that no input can reach — `split` never returns an
  // empty array. Four unkillable mutants lived in that one expression.
  const header = response.headers.get("content-type") ?? "";
  const semicolon = header.indexOf(";");
  const contentType = (semicolon === -1 ? header : header.slice(0, semicolon))
    .trim()
    .toLowerCase();
  if (!isAllowedPhotoType(contentType)) {
    // A missing header and an empty one are the same thing to a reader.
    const described = contentType === "" ? "untyped" : contentType;
    throw new PageFetchError(`Image was ${described}`);
  }

  // Buffered rather than streamed, unlike the page: R2 wants the bytes, the
  // cap is 10 MB where the page's is 6, and `content-length` on an image
  // from a CDN is reliable in a way a rendered page's is not. The length
  // check still runs on what actually arrived.
  const bytes = await response.arrayBuffer();
  if (bytes.byteLength > maxPhotoBytes) {
    throw new PageFetchError(`Image exceeded ${String(maxPhotoBytes)} bytes`);
  }

  const key = productImageKey(productId, fetchedAt);
  await env.MEDIA.put(key, bytes, { httpMetadata: { contentType } });
  return key;
}
