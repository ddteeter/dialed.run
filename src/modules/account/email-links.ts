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
import { and, eq, isNull, sql } from "drizzle-orm";
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
  const { token, write } = await emailLinkWrite(db, link, now);
  await write;
  return token;
}

/**
 * `issueEmailLink`'s token and its write, unsent — for a caller whose
 * `db.batch()` the link must land in.
 */
export async function emailLinkWrite(
  db: Db,
  link: Readonly<{ userId: string; purpose: LinkPurpose; email: string }>,
  now = nowSeconds(),
) {
  const secret = toBase64Url(crypto.getRandomValues(new Uint8Array(32)));
  const values = {
    email: link.email,
    tokenHash: await sha256(secret),
    expiresAt: now + EMAIL_LINK_TTL_S,
  };
  return {
    token: `${link.purpose}.${link.userId}.${secret}`,
    write: db
      .insert(emailVerifications)
      .values({ userId: link.userId, purpose: link.purpose, ...values })
      .onConflictDoUpdate({
        target: [emailVerifications.userId, emailVerifications.purpose],
        // A fresh link is an unspent one, whatever the last one was.
        set: { ...values, usedAt: sql`NULL` },
      }),
  };
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
  /**
  The secret's hash, which a spend must still match.
  */
  readonly tokenHash: string;
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
    tokenHash: hash,
  };
}

/**
 * The row a spend may claim: this link, still unspent, and still the
 * secret it was read with — a newer link issued since is a different row.
 */
function unspent(link: ReadLink) {
  return and(
    eq(emailVerifications.userId, link.userId),
    eq(emailVerifications.purpose, link.purpose),
    eq(emailVerifications.tokenHash, link.tokenHash),
    isNull(emailVerifications.usedAt),
  );
}

/**
 * Spend a link (law 2, claim then work): `true` only for the one caller
 * whose update claimed it. Two tabs opening the same link at once both
 * read it unspent; only one of them may then act on it.
 */
export async function didClaimEmailLink(
  db: Db,
  link: ReadLink,
  now = nowSeconds(),
): Promise<boolean> {
  const claimed = await db
    .update(emailVerifications)
    .set({ usedAt: now })
    .where(unspent(link))
    .returning({ userId: emailVerifications.userId });
  return claimed.length > 0;
}

/**
 * Hand a claimed link back, when the work it authorised did not land —
 * so the runner's next tap tries again rather than reading "already
 * used" for a change that never happened. Only this claim's own stamp is
 * undone.
 */
export async function releaseEmailLink(
  db: Db,
  link: ReadLink,
  now: number,
): Promise<void> {
  await db
    .update(emailVerifications)
    .set({ usedAt: sql`NULL` })
    .where(
      and(
        eq(emailVerifications.userId, link.userId),
        eq(emailVerifications.purpose, link.purpose),
        eq(emailVerifications.tokenHash, link.tokenHash),
        eq(emailVerifications.usedAt, now),
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
 * Useful, report, an email change. (Not a reset: spending one confirms the
 * address, D-63.) A runner who is gone is not.
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
