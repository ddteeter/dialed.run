/**
 * The links that confirm an address (ACC-3, ACC-8; round 26 #11): one per
 * runner and purpose, single use, for 24 hours, and replaced — not joined —
 * by the next one sent. The Desk's deletion link for a closed account
 * (design 289) is the same kind of link, for 7 days.
 *
 * Our own rather than Better Auth's `emailVerification`, whose tokens are
 * signed and stateless: they cannot be withdrawn, so "the old one no longer
 * works" could not be true, and a used link cannot be told from a live one.
 * A row per runner and purpose gives both. Only the token's SHA-256 is
 * stored.
 */
import { and, eq, isNull, lte, sql } from "drizzle-orm";
import type { DrizzleD1Database, drizzle } from "drizzle-orm/d1";
import { z } from "zod";

import { user } from "../../../db/schema-auth";
import { emailVerifications } from "../../../db/schema-core";
import { DELETION_LINK_TTL_S } from "../../../lib/contracts";
import { firstRowWhere } from "../../../lib/sql/keyed-read";
import { nowSeconds } from "../../../lib/now";

type Db = ReturnType<typeof drizzle>;

/**
"It works once, for 24 hours" (round 26 #11).
*/
export const EMAIL_LINK_TTL_S = 24 * 60 * 60;

/**
 * `verify` confirms the address the account was made with; `change`
 * moves the account to a new one; `delete` lets a closed account schedule
 * its own deletion (design 289).
 */
const linkPurposeSchema = z.enum(["verify", "change", "delete"]);
export type LinkPurpose = z.infer<typeof linkPurposeSchema>;

/**
 * The purposes `/account/verify` spends. Each landing reads only its own
 * links, so a deletion link is never spent as a confirmation, nor a
 * confirmation as a deletion.
 */
export const CONFIRM_PURPOSES = ["verify", "change"] as const;
export type ConfirmPurpose = (typeof CONFIRM_PURPOSES)[number];

/**
How long each purpose's link works.
*/
const LINK_TTL_S: Readonly<Record<LinkPurpose, number>> = {
  verify: EMAIL_LINK_TTL_S,
  change: EMAIL_LINK_TTL_S,
  delete: DELETION_LINK_TTL_S,
};

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
  const { token, values } = await freshLink(link, now);
  return {
    token,
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
 * A new secret, its token and the row's values: the hash, never the secret.
 */
async function freshLink(
  link: Readonly<{ userId: string; purpose: LinkPurpose; email: string }>,
  now: number,
) {
  const secret = toBase64Url(crypto.getRandomValues(new Uint8Array(32)));
  return {
    token: `${link.purpose}.${link.userId}.${secret}`,
    values: {
      email: link.email,
      tokenHash: await sha256(secret),
      expiresAt: now + LINK_TTL_S[link.purpose],
    },
  };
}

/**
 * A fresh link only where none is live (law 2, claim then work): written
 * when the runner has no link for this purpose, or over one that ran out
 * unspent, and never over a live or a spent one. The token when this
 * claim wrote the row, `undefined` when it did not — so a second press
 * sends nothing. The Desk's deletion link is one at a time (round 64
 * #372).
 */
export async function claimFreshEmailLink(
  db: Db,
  link: Readonly<{ userId: string; purpose: LinkPurpose; email: string }>,
  now = nowSeconds(),
): Promise<{ token: string; tokenHash: string } | undefined> {
  const { token, values } = await freshLink(link, now);
  const written = await db
    .insert(emailVerifications)
    .values({ userId: link.userId, purpose: link.purpose, ...values })
    .onConflictDoUpdate({
      target: [emailVerifications.userId, emailVerifications.purpose],
      set: values,
      setWhere: sql`${lte(emailVerifications.expiresAt, now)} AND ${isNull(emailVerifications.usedAt)}`,
    })
    .returning({ userId: emailVerifications.userId });
  return written.length === 0
    ? undefined
    : { token, tokenHash: values.tokenHash };
}

/**
 * The runner's open change-email link, withdrawn, unsent — for the
 * batches where the password changes hands (a reset, a change, Sign out
 * everywhere). A change requested before then must not still move the
 * account once its password has been replaced. Their other links stay.
 */
export function changeLinkWithdrawal(db: Db, userId: string) {
  return db
    .delete(emailVerifications)
    .where(
      and(
        eq(emailVerifications.userId, userId),
        eq(emailVerifications.purpose, "change"),
      ),
    );
}

/**
 * A link read back: the row it names, when its secret is the row's
 * current one. Anything else — a token of the wrong shape, a runner with
 * no link, a link replaced by a newer one — is `undefined`, which the
 * landing calls "run out".
 */
export interface ReadLink<Purpose extends LinkPurpose = LinkPurpose> {
  readonly userId: string;
  readonly purpose: Purpose;
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

export async function readEmailLink<Purpose extends LinkPurpose>(
  db: Db,
  token: unknown,
  purposes: readonly Purpose[],
): Promise<ReadLink<Purpose> | undefined> {
  const parsed = linkTokenSchema.safeParse(token);
  if (!parsed.success) return undefined;
  const [named, userId, secret] = parsed.data;
  const purpose = purposes.find((each) => each === named);
  // A link for another landing reads here as one that ran out.
  if (purpose === undefined) return undefined;
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
 * The read of whether this runner's address is confirmed, unsent — a seek
 * on `user`'s primary key, so at most one row — for a caller whose
 * `db.batch()` it rides in: the verification gate reads it beside the
 * terms gate's two (`auth/terms-gate.ts`).
 */
export function emailConfirmationRead(
  // The wider handle `lib/sql/keyed-read` explains: every spelling of a
  // dialed-core handle in the repo fits it, the feed's included.
  db: DrizzleD1Database<Record<string, unknown>>,
  userId: string,
) {
  return db
    .select({ isConfirmed: user.emailVerified })
    .from(user)
    .where(eq(user.id, userId));
}

/**
 * Whether this runner's address is confirmed: `true` or `false`, or
 * `undefined` when there is no such account. The one read of the fact;
 * the gate below decides what an absent account means.
 */
export async function emailConfirmationOf(
  db: DrizzleD1Database<Record<string, unknown>>,
  userId: string,
): Promise<boolean | undefined> {
  const [row] = await emailConfirmationRead(db, userId);
  return row?.isConfirmed;
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
