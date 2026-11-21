/**
 * The way in, from the account side (task 126, ACC-5; round 26 #20, round
 * 27 #12): Au5's request, Turnstile's attempt read off a request, and the
 * gate `modules/auth` is built with.
 */
import { sql } from "drizzle-orm";
import type { SQL } from "drizzle-orm";
import type { drizzle } from "drizzle-orm/d1";

import { accessRequests } from "../../../db/schema-core";
import { IS_INVITE_ONLY } from "../../../lib/contracts/access";
import type { BlockedRegion, FormRefusal } from "../../../lib/contracts/access";
import { newUlid } from "../../../lib/ids";
import { nowSeconds } from "../../../lib/now";
import { orSqlNull } from "../../../lib/sql/sql-null";
import { TURNSTILE_ACTIONS } from "../../../lib/turnstile-actions";
import type { TurnstileAction } from "../../../lib/turnstile-actions";
import {
  countLimit,
  countSend,
  limitAllowed,
  sendAllowed,
  sendClaimOf,
} from "../../email";
import type { TurnstileAttempt, TurnstileVerdict } from "../../ops";
import { isClosedAddress } from "./closed-addresses";
import { confirmRedemption, inviteStanding, redeemInvite } from "./invites";
import { currentTermsVersion, signUpAcceptances } from "../terms";

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
 * Au5's answers. `received` is the one receipt — "You're on the list" —
 * for a new, a repeated and a registered address alike, so the form
 * cannot be used to learn who has an account. `limited` and `refused`
 * (Turnstile) are about the browser, never the address.
 *
 * `isFromBlockedRegion` marks a receipt for a request placed in a blocked
 * state (`BLOCKED_US_REGIONS`, owner 2026-10-18): taken, since a waitlist
 * entry is not an account, and told that sign-up is not open there yet.
 * It says where the browser is, never anything about the address.
 */
export type AccessRequestResult =
  | FormRefusal
  | { readonly status: "received"; readonly isFromBlockedRegion: boolean };

/**
 * Au5 · Request access. Turnstile first; then, on a real deployment, a
 * limit per visitor address (`rate_limits`, kind `access`), so a script
 * cannot fill D7 even with a solved challenge, and a limit per address
 * asked for (`access-to`, `ACCESS_ASKS_PER_ADDRESS_PER_DAY`), in one
 * batch with one conditional upsert. The first ask's note and place stand
 * while the request is pending or invited: a repeat changes nothing. A
 * declined address that asks again is pending again, with the new ask's
 * note and place. An ask past the address's limit writes nothing and is
 * answered the same receipt.
 *
 * `blockedRegion` is the gate's answer for the request
 * (`blockedRegionOf`), read by the caller and required here, so no caller
 * can leave it out. It is recorded on the request, as the ask that made
 * it or re-opened it was placed, for D7.
 *
 * Idempotent without a key (law 8b): the address is the row's identity,
 * so a double submit is the same upsert twice.
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
  now = nowSeconds(),
): Promise<AccessRequestResult> {
  const verdict = await verify(input.attempt);
  if (!verdict.ok) return { status: "refused" };
  const email = input.email.toLowerCase();
  const received = {
    status: "received",
    isFromBlockedRegion: input.blockedRegion !== undefined,
  } as const;
  if (!input.isLimited) {
    await upsertRequest(db, { ...input, email }, sql`1`, now);
    return received;
  }
  // One batch (law 2's "a claim plus the work it authorises"): the count
  // and the request land together, and the request only if the count it
  // sits beside allowed it.
  const visitor = input.attempt.remoteIp ?? "unknown";
  const allowed = sql`${sendAllowed("access", visitor)} AND ${limitAllowed("access-to", email)}`;
  const [counted] = await db.batch([
    countSend(db, "access", visitor, now),
    countLimit(db, "access-to", email, now),
    upsertRequest(db, { ...input, email }, allowed, now),
  ]);
  const claim = sendClaimOf(counted);
  return claim.isAllowed ? received : { status: "limited", until: claim.until };
}

/**
 * The request's upsert, written only where `allowed` holds: a repeat of a
 * pending or invited request changes nothing, and a declined one is
 * pending again with this ask's note, place and time.
 */
function upsertRequest(
  db: Db,
  input: Readonly<{
    email: string;
    note: string;
    blockedRegion: BlockedRegion | undefined;
  }>,
  allowed: SQL,
  now: number,
) {
  // `orSqlNull`: a re-opening ask with no note, or from no blocked
  // state, clears the old one rather than keeping it.
  const note = orSqlNull(input.note === "" ? undefined : input.note);
  const blockedRegion = orSqlNull(input.blockedRegion);
  const declinedBefore = sql`${accessRequests.status} = 'declined'`;
  return db
    .insert(accessRequests)
    .select(
      sql`SELECT ${newUlid()}, ${input.email}, ${note}, 'pending', ${blockedRegion}, ${now}, ${now} WHERE ${allowed}`,
    )
    .onConflictDoUpdate({
      target: accessRequests.email,
      set: {
        note: sql`CASE WHEN ${declinedBefore} THEN ${note} ELSE ${accessRequests.note} END`,
        blockedRegion: sql`CASE WHEN ${declinedBefore} THEN ${blockedRegion} ELSE ${accessRequests.blockedRegion} END`,
        updatedAt: sql`CASE WHEN ${declinedBefore} THEN ${now} ELSE ${accessRequests.updatedAt} END`,
        status: sql`CASE WHEN ${declinedBefore} THEN 'pending' ELSE ${accessRequests.status} END`,
      },
    });
}
