/**
 * The public photo bucket's names (D-151, design 160 step 8): where a
 * PUBLIC kit's screened photos are served from, how long a copy may stay
 * at the edge, and the key a copy is stored under.
 *
 * Isomorphic and import-free, because the policy (`ops/security-headers`,
 * which `public/_headers` copies) and the reconcile both read it.
 */

/**
 * The bucket's custom domain, which Cloudflare's cache (and with it the
 * CSAM Scanning Tool) fronts. The policy's `img-src` admits it.
 * `wrangler.jsonc`'s `PUBLIC_PHOTOS_ORIGIN` is the switch that turns
 * copying on, and `test/bindings-conformance.test.ts` holds it to this.
 */
export const PUBLIC_PHOTOS_ORIGIN = "https://photos.dialed.run";

/**
 * Each copy's own `Cache-Control`: at most a minute at the edge or in a
 * browser once it is deleted, the minute the privacy policy promises
 * ("up to a minute after they stop being public"). The bucket's domain
 * has no Cache Rule; this header is the whole of it (deployment.md §2).
 */
export const PUBLIC_PHOTO_CACHE_CONTROL = "public, max-age=60";

/**
How many random bytes a key carries: 128 bits.
*/
const KEY_BYTES = 16;

/**
 * A fresh key for a copy: 128 bits from the platform's CSPRNG, as 32
 * lowercase hex characters, and nothing else. Derived from no id (the
 * photo's, the kit's, the runner's) and no private key, so a URL says
 * nothing about whose it is and no URL can be worked out from another.
 */
export function newPublicPhotoKey(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(KEY_BYTES));
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join(
    "",
  );
}

/**
The URL a copy is served at.
*/
export function publicPhotoUrl(origin: string, key: string): string {
  return `${origin}/${key}`;
}

/**
 * The key a link names, when it is one of the bucket's own URLs (a removal
 * request may paste one, design 160): on `PUBLIC_PHOTOS_ORIGIN` exactly,
 * its path one key of `newPublicPhotoKey`'s shape and nothing else. Any
 * other host, path or text is no key.
 */
export function publicPhotoKeyOf(location: string): string | undefined {
  if (!URL.canParse(location)) return undefined;
  const url = new URL(location);
  if (url.origin !== PUBLIC_PHOTOS_ORIGIN) return undefined;
  return KEY_PATH.exec(url.pathname)?.[1];
}

/**
A copy's path: one key, 32 lowercase hex characters.
*/
const KEY_PATH = new RegExp(`^/([0-9a-f]{${String(KEY_BYTES * 2)}})$`, "u");
