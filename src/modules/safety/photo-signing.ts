/**
 * Short-lived signed URLs for public entry photos (task 128 · SAF-7,
 * decision D-46, register D-71).
 *
 * **Why sign at all.** Cloudflare's CSAM scanning tool scans what the
 * zone's cache serves, and every photo here was served `private`, so the
 * tool — once switched on — would have seen none of them (audit §1.10).
 * A public, screened photo is therefore served at a URL that anyone may
 * fetch and any cache may keep, but only until it expires: the HMAC keeps
 * the privacy property `private` was buying, because a URL nobody was
 * handed cannot be made, and a leaked one stops working.
 *
 * **Bucketed expiry.** A URL expires on the next quarter-hour boundary
 * plus one quarter-hour, so every viewer in a fifteen-minute window is
 * handed the same URL and the cache holds a few copies per photo rather
 * than one per view. A URL therefore lives between 15 and 30 minutes, and
 * `maxSignedLifeSeconds` is the bound nothing may exceed.
 *
 * **Removal is bounded by that TTL, not purged** (design doc, open
 * question 2). A photo deleted, hidden, removed or taken down stops
 * getting new signatures at once — the route checks visibility before
 * signing and before serving — and every cached copy expires within 30
 * minutes. A zone purge would need a zone-scoped API token, which is a
 * secret for the deployment sweep; if it is ever set, a purge can be added
 * beside the delete without changing any URL.
 */
import { env } from "../../env";
import { nowSeconds } from "../../lib/now";

/**
The bucket the expiry is rounded up to.
*/
export const signedBucketSeconds = 15 * 60;

/**
 * The longest a signed URL may live, and so the longest a cache may hold a
 * removed photo.
 */
export const maxSignedLifeSeconds = 2 * signedBucketSeconds;

/**
 * When a URL signed now expires: the next bucket boundary, plus one bucket
 * — so it never expires within a quarter-hour of being handed out.
 */
export function signedExpiry(now: number = nowSeconds()): number {
  return (Math.floor(now / signedBucketSeconds) + 2) * signedBucketSeconds;
}

/**
 * The signing key: never extractable, so nothing holding it can read the
 * secret back out.
 */
export async function hmacKey(secret: string): Promise<CryptoKey> {
  return crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign", "verify"],
  );
}

/**
The signed message: the key and its expiry, on separate lines.
*/
function message(key: string, expires: number): Uint8Array<ArrayBuffer> {
  return new TextEncoder().encode(`${key}\n${String(expires)}`);
}

function toBase64Url(bytes: ArrayBuffer): string {
  return btoa(String.fromCodePoint(...new Uint8Array(bytes)))
    .replaceAll("+", "-")
    .replaceAll("/", "_")
    .replaceAll("=", "");
}

function fromBase64Url(text: string): Uint8Array<ArrayBuffer> | undefined {
  if (!/^[\w-]+$/u.test(text)) return undefined;
  const binary = atob(text.replaceAll("-", "+").replaceAll("_", "/"));
  return Uint8Array.from(binary, (char) => char.codePointAt(0) ?? 0);
}

export interface PhotoSignature {
  expires: number;
  signature: string;
}

/**
 * Signs `key` to expire at `expires`, or undefined when the deployment has
 * no signing secret. That fails closed: nothing is signed, so no shared
 * cache ever holds a photo, and the route serves it `private` through the
 * session as before (law 5 — nothing the runner asked for fails).
 */
export async function signPhotoKey(
  key: string,
  expires: number,
  secret: string | undefined = env.PHOTO_URL_SECRET,
): Promise<PhotoSignature | undefined> {
  if (secret === undefined || secret === "") return undefined;
  const signature = await crypto.subtle.sign(
    "HMAC",
    await hmacKey(secret),
    message(key, expires),
  );
  return { expires, signature: toBase64Url(signature) };
}

/**
 * Whether this signature is ours, for this key, and still live: not
 * expired, and not claiming a life longer than any URL we hand out. The
 * comparison is `crypto.subtle.verify`, which is constant-time.
 */
export async function isSignatureValid(
  key: string,
  claimed: { expires?: string | undefined; signature?: string | undefined },
  now: number = nowSeconds(),
  secret: string | undefined = env.PHOTO_URL_SECRET,
): Promise<boolean> {
  if (secret === undefined || secret === "") return false;
  const expires = Number(claimed.expires);
  if (!Number.isSafeInteger(expires)) return false;
  if (expires <= now || expires - now > maxSignedLifeSeconds) return false;
  if (claimed.signature === undefined) return false;
  const signature = fromBase64Url(claimed.signature);
  if (signature === undefined) return false;
  return crypto.subtle.verify(
    "HMAC",
    await hmacKey(secret),
    signature,
    message(key, expires),
  );
}
