/**
 * A confirm link's token, for a link that proves an inbox: 32 random
 * bytes as hex, and the SHA-256 hash a row keeps in its place. Shared by
 * `/takedown`'s confirm (design 137) and an access request's (Au5).
 */
const encoder = new TextEncoder();

function hex(bytes: ArrayBuffer | Uint8Array): string {
  return [...new Uint8Array(bytes)]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

/**
 * A confirm link's token and the hash the row keeps: only the hash is
 * stored, so a read of the table cannot confirm anything.
 */
export async function newConfirmToken(): Promise<{
  token: string;
  hash: string;
}> {
  const token = hex(crypto.getRandomValues(new Uint8Array(32)));
  return { token, hash: await confirmTokenHash(token) };
}

export async function confirmTokenHash(token: string): Promise<string> {
  return hex(await crypto.subtle.digest("SHA-256", encoder.encode(token)));
}
