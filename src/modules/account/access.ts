/**
 * The way in, from the account side (task 126, ACC-5; round 26 #20, round
 * 27 #12): Au5's request, Turnstile's attempt read off a request, and the
 * gate `modules/auth` is built with.
 */
import { sql } from "drizzle-orm";
import type { drizzle } from "drizzle-orm/d1";

import { accessRequests } from "../../db/schema-core";
import { IS_INVITE_ONLY } from "../../lib/access";
import { newUlid } from "../../lib/ids";
import { nowSeconds } from "../../lib/now";
import { orSqlNull } from "../../lib/sql-null";
import { claimEmailSend } from "../email";
import type { TurnstileAttempt, TurnstileVerdict } from "../ops";
import { inviteStanding, redeemInvite } from "./invites";

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
): TurnstileAttempt {
  return {
    token,
    remoteIp: request?.headers.get("cf-connecting-ip") ?? undefined,
    hostname: request === undefined ? "" : new URL(request.url).hostname,
  };
}

/**
 * The gate `createAuth` takes (`modules/auth/access-hook.ts`), against one
 * database and one Turnstile check.
 */
export function accessGate(
  db: Db,
  verify: (attempt: TurnstileAttempt) => Promise<TurnstileVerdict>,
) {
  return {
    isInviteOnly: IS_INVITE_ONLY,
    passesTurnstile: async (
      token: string | undefined,
      request: Request | undefined,
    ) => {
      const verdict = await verify(turnstileAttempt(token, request));
      return verdict.ok;
    },
    standing: (code: string) => inviteStanding(db, code),
    claim: (claim: Readonly<{ code: string; userId: string; email: string }>) =>
      redeemInvite(db, claim),
  };
}

/**
 * Au5's answers. `received` is the one receipt — "You're on the list" —
 * for a new, a repeated and a registered address alike, so the form
 * cannot be used to learn who has an account. `limited` and `refused`
 * (Turnstile) are about the browser, never the address.
 */
export type AccessRequestResult =
  | { readonly status: "received" }
  | { readonly status: "limited"; readonly until: number }
  | { readonly status: "refused" };

/**
 * Au5 · Request access. Turnstile first; then, on a real deployment, a
 * limit per visitor address (the email limiter's table, keyed `access:`),
 * so a script cannot fill D7 even with a solved challenge; then one
 * upsert — a repeat updates the note and leaves the request where it was
 * in the queue. A declined address that asks again is pending again.
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
  }>,
  verify: (attempt: TurnstileAttempt) => Promise<TurnstileVerdict>,
  now = nowSeconds(),
): Promise<AccessRequestResult> {
  const verdict = await verify(input.attempt);
  if (!verdict.ok) return { status: "refused" };
  if (input.isLimited) {
    const visitor = input.attempt.remoteIp ?? "unknown";
    const claim = await claimEmailSend(db, "access", visitor, now);
    if (!claim.isAllowed) return { status: "limited", until: claim.until };
  }
  // `orSqlNull`: drizzle drops an undefined value from the update's SET,
  // and a repeat with no note must clear the old one, not keep it.
  const note = orSqlNull(input.note === "" ? undefined : input.note);
  await db
    .insert(accessRequests)
    .values({
      id: newUlid(),
      email: input.email.toLowerCase(),
      note,
      createdAt: now,
      updatedAt: now,
    })
    .onConflictDoUpdate({
      target: accessRequests.email,
      set: {
        note,
        updatedAt: now,
        status: sql`CASE WHEN ${accessRequests.status} = 'declined' THEN 'pending' ELSE ${accessRequests.status} END`,
      },
    });
  return { status: "received" };
}
