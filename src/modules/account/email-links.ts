/**
 * The links that confirm an address (ACC-3, ACC-8; round 26 #11): one per
 * runner and purpose, single use, for 24 hours, and replaced — not joined —
 * by the next one sent.
 *
 * Our own rather than Better Auth's `emailVerification`, whose tokens are
 * signed and stateless: they cannot be withdrawn, so "the old one no longer
 * works" could not be true, and a used link cannot be told from a live one.
 * A row per runner and purpose gives both. Only the token's SHA-256 is
 * stored.
 */
import { and, eq, sql } from "drizzle-orm";
import type { DrizzleD1Database, drizzle } from "drizzle-orm/d1";
import { z } from "zod";

import { user } from "../../db/schema-auth";
import { emailVerifications } from "../../db/schema-core";
import { firstColumnWhere, firstRowWhere } from "../../lib/keyed-read";
import { nowSeconds } from "../../lib/now";

type Db = ReturnType<typeof drizzle>;

/**
"It works once, for 24 hours" (round 26 #11).
*/
export const EMAIL_LINK_TTL_S = 24 * 60 * 60;

/**
 * `verify` confirms the address the account was made with; `change`
 * moves the account to a new one.
 */
const linkPurposeSchema = z.enum(["verify", "change"]);
export type LinkPurpose = z.infer<typeof linkPurposeSchema>;

/**
 * A token as it arrives in a link's search: untrusted, so parsed. Exactly
 * three dot-separated parts — see `issueEmailLink`.
 */
const linkTokenSchema = z
  .string()
  .transform((token) => token.split("."))
  .pipe(z.tuple([linkPurposeSchema, z.string(), z.string()]));

function toBase64Url(bytes: Uint8Array): string {
  return btoa(String.fromCodePoint(...bytes))
    .replaceAll("+", "-")
    .replaceAll("/", "_")
    .replaceAll("=", "");
}

async function sha256(text: string): Promise<string> {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(text),
  );
  return toBase64Url(new Uint8Array(digest));
}

/**
 * A fresh link's token, written over whatever link this runner had for
 * this purpose — which is what makes the old one stop working.
 *
 * The token is `purpose.userId.secret`: the row is found by the first two
 * and proved by the third. 32 random bytes, so it cannot be guessed.
 */
export async function issueEmailLink(
  db: Db,
  link: Readonly<{ userId: string; purpose: LinkPurpose; email: string }>,
  now = nowSeconds(),
): Promise<string> {
  const secret = toBase64Url(crypto.getRandomValues(new Uint8Array(32)));
  const values = {
    email: link.email,
    tokenHash: await sha256(secret),
    expiresAt: now + EMAIL_LINK_TTL_S,
  };
  await db
    .insert(emailVerifications)
    .values({ userId: link.userId, purpose: link.purpose, ...values })
    .onConflictDoUpdate({
      target: [emailVerifications.userId, emailVerifications.purpose],
      // A fresh link is an unspent one, whatever the last one was.
      set: { ...values, usedAt: sql`NULL` },
    });
  return `${link.purpose}.${link.userId}.${secret}`;
}

/**
 * A link read back: the row it names, when its secret is the row's
 * current one. Anything else — a token of the wrong shape, a runner with
 * no link, a link replaced by a newer one — is `undefined`, which the
 * landing calls "run out".
 */
export interface ReadLink {
  readonly userId: string;
  readonly purpose: LinkPurpose;
  /**
  The address the link confirms.
  */
  readonly email: string;
  readonly expiresAt: number;
  readonly usedAt: number | undefined;
}

export async function readEmailLink(
  db: Db,
  token: unknown,
): Promise<ReadLink | undefined> {
  const parsed = linkTokenSchema.safeParse(token);
  if (!parsed.success) return undefined;
  const [purpose, userId, secret] = parsed.data;
  const row = await firstRowWhere(
    db,
    emailVerifications,
    and(
      eq(emailVerifications.userId, userId),
      eq(emailVerifications.purpose, purpose),
    ),
  );
  const hash = await sha256(secret);
  if (row?.tokenHash !== hash) return undefined;
  return {
    userId,
    purpose,
    email: row.email,
    expiresAt: row.expiresAt,
    usedAt: row.usedAt ?? undefined,
  };
}

/**
 * The statement that spends a link, for the caller's batch: it goes with
 * the change the link authorises, or neither does.
 */
export function spendEmailLink(db: Db, link: ReadLink, now = nowSeconds()) {
  return db
    .update(emailVerifications)
    .set({ usedAt: now })
    .where(
      and(
        eq(emailVerifications.userId, link.userId),
        eq(emailVerifications.purpose, link.purpose),
      ),
    );
}

/**
 * Whether this runner's address is confirmed: `true` or `false`, or
 * `undefined` when there is no such account. The one read of the fact;
 * the two gates below decide what an absent account means.
 */
export async function emailConfirmationOf(
  // The wider handle `lib/keyed-read` explains: every spelling of a
  // dialed-core handle in the repo fits it, the feed's included.
  db: DrizzleD1Database<Record<string, unknown>>,
  userId: string,
): Promise<boolean | undefined> {
  return firstColumnWhere(db, user, user.emailVerified, eq(user.id, userId));
}

/**
 * Whether this runner's address is confirmed (seam 7): the gate on
 * anything that trusts the address or that another runner acts on —
 * Useful, report, an email change, a reset by email. A runner who is gone
 * is not.
 */
export async function isVerified(
  db: DrizzleD1Database<Record<string, unknown>>,
  userId: string,
): Promise<boolean> {
  return (await emailConfirmationOf(db, userId)) === true;
}

/**
 * Whether this runner's entries must stay private (decision D-50): an
 * account whose address is not confirmed yet. Only an account can be
 * unconfirmed, so a runner with no `user` row is not held back here — which
 * never happens in production, where every runner signed up.
 */
export async function isUnconfirmed(
  db: DrizzleD1Database<Record<string, unknown>>,
  userId: string,
): Promise<boolean> {
  return (await emailConfirmationOf(db, userId)) === false;
}
