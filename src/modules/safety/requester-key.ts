/**
 * Who a `/takedown` request came from, as one key for the abuse limits
 * (design 137): two addresses that reach one inbox are one requester.
 *
 * validator's `normalizeEmail` knows the providers whose rules are their
 * own: Gmail ignores dots and reads `googlemail.com` as `gmail.com`;
 * Gmail, Outlook and iCloud drop a `+tag`; Yahoo drops a `-tag`. Past
 * that, a `+tag` is dropped on every domain, because almost no provider
 * hands `me+x` to a different person than `me`.
 *
 * A key is only ever compared. Mail goes to the address as typed.
 */
import normalizeEmail from "validator/lib/normalizeEmail";

export function requesterKey(email: string): string {
  const typed = email.trim().toLowerCase();
  // Not an address at all: the form never sends one, and the key is
  // still the text, rather than validator's reading of it as a domain.
  if (!typed.includes("@")) return typed;
  // False when Gmail's rules leave nothing before the `@` ("+x@gmail.com").
  const normalized = normalizeEmail(typed) || typed;
  const at = normalized.lastIndexOf("@");
  const [local = ""] = normalized.slice(0, at).split("+", 1);
  return `${local}${normalized.slice(at)}`;
}

const encoder = new TextEncoder();

/**
 * The visitor's IP as a key (design 137): HMAC-SHA-256 under
 * `TAKEDOWN_SECRET`, hex. Keyed because a plain hash of an IPv4 address is
 * undone by trying all four billion; the raw address is never stored.
 * `undefined` without the secret or the address — the cap then counts the
 * email key alone.
 */
export async function ipKey(
  ip: string | undefined,
  secret: string | undefined,
): Promise<string | undefined> {
  if (ip === undefined || secret === undefined || secret === "") return;
  const key = await crypto.subtle.importKey(
    "raw",
    encoder.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const signed = await crypto.subtle.sign("HMAC", key, encoder.encode(ip));
  return [...new Uint8Array(signed)]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}
