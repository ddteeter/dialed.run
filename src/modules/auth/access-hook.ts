/**
 * The way in (task 126, ACC-5; decision D-39; round 26 #20, round 27 #12):
 * Turnstile, then the invite code, on both ways an account is made — the
 * email form and Google — and the code spent when the account is.
 *
 * **Two moments.** Before the request (`admitSignUp`): an email sign-up, or
 * a Google attempt that asks to sign up (`requestSignUp`), must carry a
 * Turnstile token that passes and, with invite-only on, a code that is
 * open. That refuses before Better Auth does anything — before the
 * redirect, for Google, so nobody is sent to Google's consent screen with
 * a code that was never going to work. Then, as the account is created
 * (`claimInvite`, the user create hook), the code is claimed: this is
 * where "consumed at account creation" is true, and where two sign-ups
 * racing for one single-use code are told apart.
 *
 * **Google's code survives the round trip in Better Auth's OAuth state**,
 * as server context (`addOAuthServerContext`): set by this hook, only
 * after the code checked out, and never from the client — so the create
 * hook on the callback reads a code that was validated before the
 * redirect, carried in the state Better Auth already signs and expires.
 * A Google sign-in to an account that exists makes no account, so it
 * needs no code; one that would make an account from the log-in page is
 * refused by Better Auth itself (`disableImplicitSignUp`).
 */
import { APIError, addOAuthServerContext, getOAuthState } from "better-auth/api";
import { z } from "zod";

import {
  ACCESS_CODES,
  ACCESS_HEADERS,
  INVITE_COPY,
  TURNSTILE_REFUSED,
  inviteCodeField,
} from "../../lib/access";
import { newUlid } from "../../lib/ids";

/**
 * What the code came to: open (for the check before), `redeemed` (spent
 * on this account), or the two refusals the form names.
 */
export type InviteStanding = "open" | "used" | "invalid";
export type InviteClaim = "redeemed" | "used" | "invalid";

/**
 * The gate's dependencies. Required on `createAuth`, so no construction of
 * the auth instance can leave the door open by forgetting it; the
 * instance wires the database and Turnstile, tests a stub.
 */
export interface AccessGate {
  /**
  `lib/access.ts`'s `IS_INVITE_ONLY`, handed in so a test can turn it off.
  */
  isInviteOnly: boolean;
  /**
   * Whether this token is a Turnstile answer for this request. The
   * request is absent when Better Auth's API is called from the server.
   */
  passesTurnstile: (
    token: string | undefined,
    request: Request | undefined,
  ) => Promise<boolean>;
  standing: (code: string) => Promise<InviteStanding>;
  claim: (
    claim: Readonly<{ code: string; userId: string; email: string }>,
  ) => Promise<InviteClaim>;
}

function refuse(code: keyof typeof ACCESS_CODES): never {
  if (code === "turnstile") {
    throw new APIError("FORBIDDEN", {
      code: ACCESS_CODES.turnstile,
      message: TURNSTILE_REFUSED,
    });
  }
  throw new APIError("BAD_REQUEST", {
    code: ACCESS_CODES[code],
    message: INVITE_COPY[code],
  });
}

/**
Only `requestSignUp` is read from a social sign-in's body.
*/
const socialBodySchema = z.object({ requestSignUp: z.boolean().optional() });

/**
 * Which kind of account-making request this is, if either: an email
 * sign-up, or a Google attempt from Au2 (the only one that asks to sign
 * up).
 */
function signUpKind(
  path: string,
  body: unknown,
): "email" | "google" | undefined {
  if (path === "/sign-up/email") return "email";
  const isSocial = path === "/sign-in/social";
  const asksToSignUp = socialBodySchema.safeParse(body).data?.requestSignUp;
  return isSocial && asksToSignUp === true ? "google" : undefined;
}

/**
 * The code a header carried, parsed as the form parses it: `missing` when
 * there is none, `invalid` when it is not a code's shape.
 */
function codeFrom(
  headers: Headers | undefined,
): { ok: true; code: string } | { ok: false; refusal: "missing" | "invalid" } {
  const typed = headers?.get(ACCESS_HEADERS.inviteCode) ?? "";
  if (typed === "") return { ok: false, refusal: "missing" };
  const parsed = inviteCodeField.safeParse(typed);
  return parsed.success
    ? { ok: true, code: parsed.data }
    : { ok: false, refusal: "invalid" };
}

/**
 * The request, as far as the gate reads it — the slice of Better Auth's
 * middleware context both before-hooks take.
 */
export interface HookRequest {
  path: string;
  body?: unknown;
  headers?: Headers | undefined;
  request?: Request | undefined;
}

/**
 * The before-hook's half: Turnstile first (it runs whether or not
 * invite-only is on, and after the public gate too), then the code.
 */
export async function admitSignUp(
  gate: AccessGate,
  ctx: HookRequest,
): Promise<void> {
  const kind = signUpKind(ctx.path, ctx.body);
  if (kind === undefined) return;
  const token = ctx.headers?.get(ACCESS_HEADERS.turnstileToken) ?? undefined;
  if (!(await gate.passesTurnstile(token, ctx.request))) refuse("turnstile");
  if (!gate.isInviteOnly) return;
  const typed = codeFrom(ctx.headers);
  if (!typed.ok) refuse(typed.refusal);
  const standing = await gate.standing(typed.code);
  if (standing !== "open") refuse(standing);
  if (kind === "google") await addOAuthServerContext({ inviteCode: typed.code });
}

/**
What the create hook reads back out of Google's state.
*/
const oauthStateSchema = z.object({
  serverContext: z.object({ inviteCode: z.string() }),
});

/**
 * The code an account is being made with: the email form's header, or
 * the one this hook put into Google's state before the redirect.
 */
async function codeForCreate(
  context: HookRequest | null,
): Promise<string | undefined> {
  if (context?.path === "/sign-up/email") {
    const typed = codeFrom(context.headers);
    return typed.ok ? typed.code : undefined;
  }
  const state = oauthStateSchema.safeParse(await getOAuthState());
  return state.data?.serverContext.inviteCode;
}

/**
 * The user create hook: every account is made with no name (owner,
 * 2026-09-27 — a runner is their handle), and, with invite-only on, only
 * by spending a code.
 *
 * The account's id is minted here rather than by Better Auth, so the
 * claim can be written against it before the row exists: Better Auth
 * makes the user, so no batch of ours can hold both, and the claim's
 * hold (`invite_redemptions.held_until`) is what covers the gap.
 */
export function claimInvite(gate: AccessGate) {
  return async (
    user: { email: string } & Record<string, unknown>,
    context: HookRequest | null,
  ) => {
    if (!gate.isInviteOnly) return { data: { ...user, name: "" } };
    const code = await codeForCreate(context);
    if (code === undefined) refuse("missing");
    const id = newUlid();
    const claimed = await gate.claim({ code, userId: id, email: user.email });
    if (claimed !== "redeemed") refuse(claimed);
    return { data: { ...user, id, name: "" } };
  };
}
