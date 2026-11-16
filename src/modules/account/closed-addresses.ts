/**
 * Closed addresses (SA-L09; owner, 2026-11-15): when the account purge
 * deletes an account an operator closed, each of its email addresses is
 * kept as a keyed fingerprint for `CLOSED_ADDRESS_KEPT_S`, and sign-up
 * refuses an address that matches. GDPR Art. 17(3) and the abuse-prevention
 * interest allow keeping that much, and nothing more: no name, no handle,
 * no content, and a fingerprint that cannot be checked without the secret.
 *
 * HMAC-SHA256 under `CLOSED_ADDRESS_SECRET`, over a purpose label and the
 * address trimmed and lower-cased, so `Ada@Example.com ` and
 * `ada@example.com` are one address. With no secret, nothing is kept and
 * nothing is refused: a missing key must never refuse a sign-up.
 */
import { eq, lt } from "drizzle-orm";
import type { drizzle } from "drizzle-orm/d1";

import { closedAddresses } from "../../db/schema-core";
import { hmacKey } from "../../lib/hmac-key";

type Db = ReturnType<typeof drizzle>;

/**
How long a closed address is refused: 3 years, as moderation records are kept.
*/
export const CLOSED_ADDRESS_KEPT_S = 3 * 365 * 24 * 60 * 60;

const PURPOSE = "dialed.run closed address v1";

/**
 * The fingerprint of one address under `secret`, as lowercase hex.
 */
export async function closedAddressHash(
  secret: string,
  email: string,
): Promise<string> {
  const key = await hmacKey(secret, ["sign"]);
  const message = new TextEncoder().encode(
    `${PURPOSE}|${email.trim().toLowerCase()}`,
  );
  const signature = await crypto.subtle.sign("HMAC", key, message);
  return [...new Uint8Array(signature)]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

/**
 * The rows the purge writes for a closed account's addresses, in the same
 * batch as the delete of its `user` row. None without a secret.
 */
export async function closedAddressRows(
  secret: string | undefined,
  emails: readonly string[],
  closedAt: number,
): Promise<{ hash: string; closedAt: number }[]> {
  if (secret === undefined || secret === "") return [];
  const hashes = await Promise.all(
    emails.map((email) => closedAddressHash(secret, email)),
  );
  return [...new Set(hashes)].map((hash) => ({ hash, closedAt }));
}

/**
 * Whether sign-up should refuse this address: it belonged to an account an
 * operator closed and the purge deleted, inside the kept window. A
 * primary-key probe; `false` without a secret.
 */
export async function isClosedAddress(
  db: Db,
  secret: string | undefined,
  email: string,
): Promise<boolean> {
  if (secret === undefined || secret === "") return false;
  const hash = await closedAddressHash(secret, email);
  const [row] = await db
    .select({ hash: closedAddresses.hash })
    .from(closedAddresses)
    .where(eq(closedAddresses.hash, hash))
    .limit(1);
  return row !== undefined;
}

/**
The daily sweep's statement: every fingerprint past its window.
*/
export function forgetClosedAddresses(db: Db, now: number) {
  return db
    .delete(closedAddresses)
    .where(lt(closedAddresses.closedAt, now - CLOSED_ADDRESS_KEPT_S));
}
