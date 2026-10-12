/**
 * An HMAC-SHA-256 key made from a secret: never extractable, and good for
 * only the operations asked for. The one place a signed link or a keyed
 * hash turns its secret into a `CryptoKey`.
 */
export async function hmacKey(
  secret: string,
  usages: readonly ("sign" | "verify")[],
): Promise<CryptoKey> {
  return crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    [...usages],
  );
}
