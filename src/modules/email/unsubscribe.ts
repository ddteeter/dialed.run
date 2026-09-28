/**
 * The unsubscribe link (round 26 #19): signed for one runner and one kind,
 * never expiring, and working without a session — "Opening it is the
 * unsubscribe: no confirm button and no 'are you sure'."
 *
 * HMAC-SHA256, keyed by the auth secret, over `purpose|userId|kind` — the
 * purpose label first, so a signature made for this can never be replayed
 * as anything else the secret signs. Rotating `BETTER_AUTH_SECRET`
 * breaks every link in every inbox; that is the cost of a link that needs
 * no table, and it is the owner's to pay knowingly.
 */
import { z } from "zod";

import {
  emailPreferenceKindSchema,
  type EmailPreferenceKind,
} from "../../lib/email";

/**
The key's purpose label. Changing it invalidates every link ever sent.
*/
const PURPOSE = "dialed.run unsubscribe v1";

const encoder = new TextEncoder();

/**
 * The key: the auth secret itself, never extractable. Exported for its own
 * test — nothing else here hands the key out.
 */
export async function signingKey(secret: string): Promise<CryptoKey> {
  return crypto.subtle.importKey(
    "raw",
    encoder.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign", "verify"],
  );
}

function toBase64Url(bytes: ArrayBuffer): string {
  return btoa(String.fromCodePoint(...new Uint8Array(bytes)))
    .replaceAll("+", "-")
    .replaceAll("/", "_")
    .replaceAll("=", "");
}

/**
 * The bytes a url-safe base64 string spells, or undefined for one that
 * spells none. Two shapes reach `atob` and make it throw: a character
 * outside the alphabet, and a length one past a multiple of four — no
 * byte count encodes to that, so it is always a truncated or padded-out
 * link, never a signature.
 */
function fromBase64Url(text: string): Uint8Array<ArrayBuffer> | undefined {
  if (!/^[\w-]+$/u.test(text) || text.length % 4 === 1) return undefined;
  const binary = atob(text.replaceAll("-", "+").replaceAll("_", "/"));
  return Uint8Array.from(binary, (char) => char.codePointAt(0) ?? 0);
}

function message(
  userId: string,
  kind: EmailPreferenceKind,
): Uint8Array<ArrayBuffer> {
  // The purpose label leads the message, so a signature made for this can
  // never be replayed as anything else the same secret signs.
  return encoder.encode(`${PURPOSE}|${userId}|${kind}`);
}

export async function unsubscribeSignature(
  secret: string,
  userId: string,
  kind: EmailPreferenceKind,
): Promise<string> {
  const key = await signingKey(secret);
  return toBase64Url(
    await crypto.subtle.sign("HMAC", key, message(userId, kind)),
  );
}

/**
 * The link's search params — `u`, `k`, `s` — as the landing route and the
 * one-click POST both read them. Short names, because the link is read in
 * an email client's status bar, not by a person.
 */
export const unsubscribeSearchSchema = z.object({
  u: z.string().min(1),
  k: emailPreferenceKindSchema,
  s: z.string().min(1),
});

export type UnsubscribeSearch = z.infer<typeof unsubscribeSearchSchema>;

export async function unsubscribeUrl(
  origin: string,
  secret: string,
  userId: string,
  kind: EmailPreferenceKind,
): Promise<string> {
  const search = new URLSearchParams({
    u: userId,
    k: kind,
    s: await unsubscribeSignature(secret, userId, kind),
  });
  return `${origin}/account/unsubscribe?${search.toString()}`;
}

/**
 * The runner and kind a link names, when its signature is theirs; nothing
 * for a tampered, truncated or foreign link. Compared by `verify`, which
 * is constant-time, rather than by re-signing and comparing strings.
 */
export async function verifiedUnsubscribe(
  secret: string,
  search: unknown,
): Promise<{ userId: string; kind: EmailPreferenceKind } | undefined> {
  const parsed = unsubscribeSearchSchema.safeParse(search);
  if (!parsed.success) return undefined;
  const { u: userId, k: kind, s } = parsed.data;
  const signature = fromBase64Url(s);
  if (signature === undefined) return undefined;
  const key = await signingKey(secret);
  const isValid = await crypto.subtle.verify(
    "HMAC",
    key,
    signature,
    message(userId, kind),
  );
  return isValid ? { userId, kind } : undefined;
}
