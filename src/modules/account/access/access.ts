/**
 * The way in, from the account side (task 126, ACC-5; round 26 #20, round
 * 27 #12): Au5's request, Turnstile's attempt read off a request, and the
 * gate `modules/auth` is built with.
 */
import { eq, sql } from "drizzle-orm";
import type { SQL } from "drizzle-orm";
import type { drizzle } from "drizzle-orm/d1";

import { accessAsks, accessRequests } from "../../../db/schema-core";
import {
  ACCESS_CONFIRM_HOURS,
  IS_INVITE_ONLY,
} from "../../../lib/contracts/access";
import type { BlockedRegion, FormRefusal } from "../../../lib/contracts/access";
import { confirmTokenHash, newConfirmToken } from "../../../lib/confirm-token";
import { newUlid } from "../../../lib/ids";
import { nowSeconds } from "../../../lib/now";
import { firstRowWhere } from "../../../lib/sql/keyed-read";
import { orSqlNull } from "../../../lib/sql/sql-null";
import { TURNSTILE_ACTIONS } from "../../../lib/turnstile-actions";
import type { TurnstileAction } from "../../../lib/turnstile-actions";
import {
  claimEmailSend,
  countLimit,
  deliverEmail,
  limitAllowed,
  limitClaimOf,
  type EmailDeps,
} from "../../email";
import type { TurnstileAttempt, TurnstileVerdict } from "../../ops";
import { isClosedAddress } from "./closed-addresses";
import { confirmRedemption, inviteStanding, redeemInvite } from "./invites";
import { currentTermsVersion, signUpAcceptances } from "../terms";
import type { Background } from "../verification";

type Db = ReturnType<typeof drizzle>;

/**
 * What Turnstile needs from a request: the address Cloudflare's edge saw
 * (a client cannot write `cf-connecting-ip`) and the host it came in on,
 * which the challenge must have been solved on. No request — Better
 * Auth's API called from the server — is no address and no host.
 */
export function turnstileAttempt(
  token: string | undefined,
  request: Request | undefined,
  action: TurnstileAction | undefined,
): TurnstileAttempt {
  return {
    token,
    remoteIp: request?.headers.get("cf-connecting-ip") ?? undefined,
    hostname: request === undefined ? "" : new URL(request.url).hostname,
    action,
  };
}

/**
 * The gate `createAuth` takes (`modules/auth/access-hook.ts`), against one
 * database and one Turnstile check. `termsVersion` is the published terms'
 * version, `undefined` while none are published (D-93) — the shipped
 * text's, unless a test says otherwise. `closedAddressSecret` is
 * `CLOSED_ADDRESS_SECRET` (SA-L09); without it no address is refused.
 */
export function accessGate(
  db: Db,
  verify: (attempt: TurnstileAttempt) => Promise<TurnstileVerdict>,
  termsVersion: number | undefined = currentTermsVersion(),
  closedAddressSecret?: string,
) {
  return {
    isInviteOnly: IS_INVITE_ONLY,
    checksAge: true,
    passesTurnstile: async (
      token: string | undefined,
      request: Request | undefined,
    ) => {
      const verdict = await verify(
        turnstileAttempt(token, request, TURNSTILE_ACTIONS.signUp),
      );
      return verdict.ok;
    },
    standing: (code: string) => inviteStanding(db, code),
    claim: (claim: Readonly<{ code: string; userId: string; email: string }>) =>
      redeemInvite(db, claim),
    isClosedAddress: (email: string) =>
      isClosedAddress(db, closedAddressSecret, email),
    // The account exists: its invite's use is spent for good, and the
    // published terms it was made under are recorded (ACC-6: creating the
    // account is the acceptance) — one batch, the account's first app
    // write. While no terms are published there is nothing to record
    // (D-93). Better Auth makes the `user` row itself, so no batch can
    // hold that too; a failure here leaves an account with no acceptance,
    // which the terms prompt asks about at its first sign-in.
    confirm: async (userId: string) => {
      const now = nowSeconds();
      await db.batch([
        confirmRedemption(db, userId, now),
        ...signUpAcceptances(db, userId, termsVersion, now),
      ]);
    },
  };
}

/**
 * Au5's answers. `sent` is the one answer — "Check your email" — for a
 * new, a repeated and a registered address alike, and whether or not the
 * address's confirm links for the day are used up, so the form cannot be
 * used to learn who has an account or who asked. `limited` and `refused`
 * (Turnstile) are about the browser, never the address.
 */
export type AccessRequestResult = FormRefusal | { readonly status: "sent" };

/**
How long an ask's confirm link works, in seconds.
*/
export const ACCESS_CONFIRM_S = ACCESS_CONFIRM_HOURS * 60 * 60;

/**
Where an ask's confirm link opens, on the app's own origin.
*/
export function accessConfirmUrl(origin: string, token: string): string {
  return `${origin}/account/confirm-access?token=${token}`;
}

/**
 * Au5 · Request access. Turnstile first; then, on a real deployment, a
 * limit per visitor address (`rate_limits`, kind `access`), so a script
 * cannot fill the table even with a solved challenge, and a visitor past
 * it writes nothing at all. Then the ask is kept, unconfirmed, with the
 * hash of a fresh token, and its link is sent to the address it names:
 * on a real deployment only within that address's confirm links for the
 * day (`access-confirm-to`), counted in one batch with the ask's
 * conditional insert. Nothing reaches D7 until the link is opened
 * (`confirmAccessAsk`).
 *
 * `blockedRegion` is the gate's answer for the request
 * (`blockedRegionOf`), read by the caller and required here, so no caller
 * can leave it out. It is kept on the ask, as the ask was placed, for D7
 * and the receipt the link opens.
 *
 * The link is sent after the answer, like an email change's (SA-L18: it
 * carries a live token, so no outbox row may hold it): a send that fails
 * is reported, and asking again is the retry.
 */
export async function requestAccess(
  db: Db,
  input: Readonly<{
    email: string;
    note: string;
    attempt: TurnstileAttempt;
    isLimited: boolean;
    blockedRegion: BlockedRegion | undefined;
  }>,
  verify: (attempt: TurnstileAttempt) => Promise<TurnstileVerdict>,
  mail: Readonly<{ deps: EmailDeps; background: Background }>,
  now = nowSeconds(),
): Promise<AccessRequestResult> {
  const verdict = await verify(input.attempt);
  if (!verdict.ok) return { status: "refused" };
  if (input.isLimited) {
    const visitor = input.attempt.remoteIp ?? "unknown";
    const claim = await claimEmailSend(db, "access", visitor, now);
    if (!claim.isAllowed) return { status: "limited", until: claim.until };
  }
  const { token, hash } = await newConfirmToken();
  const ask = {
    id: newUlid(),
    email: input.email.toLowerCase(),
    note: input.note === "" ? undefined : input.note,
    blockedRegion: input.blockedRegion,
    tokenHash: hash,
    createdAt: now,
  };
  if (await isAskKept(db, ask, input.isLimited, now)) {
    const { background } = mail;
    background.keepAlive(sendConfirmLink(db, ask.email, token, mail));
  }
  return { status: "sent" };
}

type NewAsk = Readonly<{
  id: string;
  email: string;
  note: string | undefined;
  blockedRegion: BlockedRegion | undefined;
  tokenHash: string;
  createdAt: number;
}>;

/**
 * Keep the ask, and say whether its link may go. On a real deployment
 * the address's count and the insert are one batch, and the insert lands
 * only where the count it sits beside allowed it.
 */
async function isAskKept(
  db: Db,
  ask: NewAsk,
  isLimited: boolean,
  now: number,
): Promise<boolean> {
  if (!isLimited) {
    await db.insert(accessAsks).values(ask);
    return true;
  }
  const allowed = limitAllowed("access-confirm-to", ask.email);
  const [counted] = await db.batch([
    countLimit(db, "access-confirm-to", ask.email, now),
    db
      .insert(accessAsks)
      .select(
        sql`SELECT ${ask.id}, ${ask.email}, ${orSqlNull(ask.note)}, ${orSqlNull(ask.blockedRegion)}, ${ask.tokenHash}, ${ask.createdAt}, NULL WHERE ${allowed}`,
      ),
  ]);
  return limitClaimOf("access-confirm-to", counted).isAllowed;
}

async function sendConfirmLink(
  db: Db,
  email: string,
  token: string,
  mail: Readonly<{ deps: EmailDeps; background: Background }>,
): Promise<void> {
  try {
    await deliverEmail(
      db,
      {
        to: { address: email },
        template: {
          kind: "access_confirm",
          url: accessConfirmUrl(mail.deps.origin, token),
        },
      },
      mail.deps,
    );
  } catch (error) {
    // Never the address (law 7): the surface is enough to find it.
    mail.background.report(error, { surface: "access-confirm-link" });
  }
}

/**
 * A confirm link's answer: today's "You're on the list" receipt, for the
 * address the ask named and as it was placed, or a link that matches no
 * ask still within its 48 hours. The address is the link's own: only its
 * inbox was sent the token.
 */
export type AccessConfirmResult =
  | {
      readonly status: "confirmed";
      readonly email: string;
      readonly isFromBlockedRegion: boolean;
    }
  | { readonly status: "not_found" };

/**
 * An ask's confirm link, opened: the address is proved, and the ask
 * becomes the address's access request. The first confirmed ask's note
 * and place stand while the request is pending or invited: a repeat
 * changes nothing. A declined address confirmed again is pending again,
 * with that ask's note and place. On a real deployment an address takes
 * `ACCESS_ASKS_PER_ADDRESS_PER_DAY` confirmed asks a day (`access-to`);
 * one past them changes nothing and answers the same receipt.
 *
 * A link works for `ACCESS_CONFIRM_S` from its ask, and past them answers
 * as an unknown link. A second open of a confirmed link answers the same
 * receipt and writes nothing.
 */
export async function confirmAccessAsk(
  db: Db,
  input: Readonly<{ token: string; isLimited: boolean }>,
  now = nowSeconds(),
): Promise<AccessConfirmResult> {
  const ask = await firstRowWhere(
    db,
    accessAsks,
    eq(accessAsks.tokenHash, await confirmTokenHash(input.token)),
  );
  if (ask === undefined || now > ask.createdAt + ACCESS_CONFIRM_S) {
    return { status: "not_found" };
  }
  const receipt = {
    status: "confirmed",
    email: ask.email,
    isFromBlockedRegion: ask.blockedRegion !== null,
  } as const;
  if (ask.confirmedAt !== null) return receipt;
  const confirmed = db
    .update(accessAsks)
    .set({ confirmedAt: now })
    .where(eq(accessAsks.id, ask.id));
  if (input.isLimited) {
    await db.batch([
      confirmed,
      countLimit(db, "access-to", ask.email, now),
      upsertRequest(db, ask, limitAllowed("access-to", ask.email), now),
    ]);
  } else {
    await db.batch([confirmed, upsertRequest(db, ask, sql`1`, now)]);
  }
  return receipt;
}

/**
 * The request's upsert, written only where `allowed` holds: a repeat of a
 * pending or invited request changes nothing, and a declined one is
 * pending again with this ask's note, place and time — its `created_at`
 * too, so it queues on D7 behind the requests made since.
 */
function upsertRequest(
  db: Db,
  ask: Readonly<{
    email: string;
    note: string | null;
    blockedRegion: string | null;
  }>,
  allowed: SQL,
  now: number,
) {
  // `orSqlNull`: a re-opening ask with no note, or from no blocked
  // state, clears the old one rather than keeping it.
  const note = orSqlNull(ask.note ?? undefined);
  const blockedRegion = orSqlNull(ask.blockedRegion ?? undefined);
  const declinedBefore = sql`${accessRequests.status} = 'declined'`;
  return db
    .insert(accessRequests)
    .select(
      sql`SELECT ${newUlid()}, ${ask.email}, ${note}, 'pending', ${blockedRegion}, ${now}, ${now} WHERE ${allowed}`,
    )
    .onConflictDoUpdate({
      target: accessRequests.email,
      set: {
        note: sql`CASE WHEN ${declinedBefore} THEN ${note} ELSE ${accessRequests.note} END`,
        blockedRegion: sql`CASE WHEN ${declinedBefore} THEN ${blockedRegion} ELSE ${accessRequests.blockedRegion} END`,
        createdAt: sql`CASE WHEN ${declinedBefore} THEN ${now} ELSE ${accessRequests.createdAt} END`,
        updatedAt: sql`CASE WHEN ${declinedBefore} THEN ${now} ELSE ${accessRequests.updatedAt} END`,
        status: sql`CASE WHEN ${declinedBefore} THEN 'pending' ELSE ${accessRequests.status} END`,
      },
    });
}
