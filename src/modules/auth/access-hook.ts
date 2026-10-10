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
 * a code that was never going to work. **Google from Au2 may go with no
 * code at all**: the press cannot know yet whether the Google address
 * already has an account, and one that does signs in without a code.
 * Only a new account needs one, so a Google attempt with none is refused
 * at the create hook instead, and comes back to Au2 as
 * `?error=INVITE_MISSING`. Then, as the account is created
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
 * needs no code — from either page; one that would make an account from
 * the log-in page is refused by Better Auth itself
 * (`disableImplicitSignUp`).
 */
import {
  APIError,
  addOAuthServerContext,
  getOAuthState,
} from "better-auth/api";
import { z } from "zod";

import {
  ACCESS_CODES,
  ACCESS_HEADERS,
  INVITE_COPY,
  TURNSTILE_REFUSED,
  inviteCodeField,
} from "../../lib/contracts/access";
import {
  AGE_CODES,
  AGE_COPY,
  AGE_REFUSED_COOKIE,
  AGE_REFUSED_SECONDS,
  BIRTH_DATE_HEADER,
  birthDateField,
  isOldEnough,
  isoDayOf,
} from "../../lib/contracts/age";
import { newUlid } from "../../lib/ids";
import { nowSeconds } from "../../lib/now";

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
  `lib/contracts/access.ts`'s `IS_INVITE_ONLY`, handed in so a test can turn it off.
  */
  isInviteOnly: boolean;
  /**
   * Whether sign-up asks the runner's age (design 134). Always on in the
   * app (`account`'s `accessGate`); off only in a test that is not about
   * the way in and makes accounts without a date, as `isInviteOnly` is.
   */
  checksAge: boolean;
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
  /**
   * The account now exists: a claim's use is spent for good, whatever
   * later happens to the account, and the terms it was made under are
   * recorded (ACC-6). Every account, invite or not, email or Google.
   */
  confirm: (userId: string) => Promise<void>;
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
export function signUpKind(
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
 * The age refusal, which also sets the cookie that holds it for a day
 * (`AGE_REFUSED_COOKIE`): Secure and HttpOnly, as nothing in the page
 * needs to read it — only this gate does.
 */
function refuseAge(): never {
  throw new APIError(
    "FORBIDDEN",
    { code: AGE_CODES.refused, message: AGE_COPY.refused },
    {
      "set-cookie": `${AGE_REFUSED_COOKIE}=1; Max-Age=${String(AGE_REFUSED_SECONDS)}; Path=/; HttpOnly; Secure; SameSite=Lax`,
    },
  );
}

function refuseMissingAge(): never {
  throw new APIError("BAD_REQUEST", {
    code: AGE_CODES.missing,
    message: AGE_COPY.missing,
  });
}

/**
 * Whether the request carries the refusal cookie: its own name, not one
 * that merely ends the same.
 */
function wasRefusedBefore(headers: Headers | undefined): boolean {
  return (
    headers
      ?.get("cookie")
      ?.split(";")
      .some((cookie) => cookie.trim().startsWith(`${AGE_REFUSED_COOKIE}=`)) ===
    true
  );
}

/**
 * The age half of the before-hook (design 134). A browser refused in the
 * last day is refused again whatever it sends. Google with no date may be
 * an account that exists, as with the code; the create hook refuses it if
 * it turns out not to be. A date that passes on a Google attempt is
 * carried through the redirect in the state Better Auth signs, so the
 * create hook can tell.
 */
async function admitAge(
  kind: "email" | "google",
  headers: Headers | undefined,
): Promise<void> {
  if (wasRefusedBefore(headers)) refuseAge();
  const typed = headers?.get(BIRTH_DATE_HEADER) ?? "";
  if (typed === "" && kind === "google") return;
  const parsed = birthDateField.safeParse(typed);
  // One sentence for every unusable date: Au2's own schema has already
  // said which, so only a caller that skipped the form reaches this.
  if (!parsed.success) refuseMissingAge();
  if (!isOldEnough(parsed.data, isoDayOf(nowSeconds()))) refuseAge();
  if (kind === "google") await addOAuthServerContext({ ageChecked: true });
}

/**
 * The before-hook's half: Turnstile first (it runs whether or not
 * invite-only is on, and after the public gate too), then the age, then
 * the code.
 */
export async function admitSignUp(
  gate: AccessGate,
  ctx: HookRequest,
): Promise<void> {
  const kind = signUpKind(ctx.path, ctx.body);
  if (kind === undefined) return;
  const token = ctx.headers?.get(ACCESS_HEADERS.turnstileToken) ?? undefined;
  if (!(await gate.passesTurnstile(token, ctx.request))) refuse("turnstile");
  if (gate.checksAge) await admitAge(kind, ctx.headers);
  if (!gate.isInviteOnly) return;
  const typed = codeFrom(ctx.headers);
  // Google with no code may be an account that exists: see the module
  // comment. The create hook refuses it if it turns out not to be.
  if (kind === "google" && !typed.ok && typed.refusal === "missing") return;
  if (!typed.ok) refuse(typed.refusal);
  const standing = await gate.standing(typed.code);
  // `used` reads as `invalid`: one sentence for both, so a prober cannot
  // tell a spent code from one nobody made.
  if (standing !== "open") refuse("invalid");
  if (kind === "google")
    await addOAuthServerContext({ inviteCode: typed.code });
}

/**
What the create hook reads back out of Google's state.
*/
const oauthStateSchema = z.object({
  serverContext: z.object({
    inviteCode: z.string().optional(),
    ageChecked: z.literal(true).optional(),
  }),
});

async function serverContext() {
  return oauthStateSchema.safeParse(await getOAuthState()).data?.serverContext;
}

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
  const state = await serverContext();
  return state?.inviteCode;
}

/**
 * Whether the account being made had its age checked: the email form's
 * before-hook refuses a sign-up without one, so reaching the create hook
 * is the check; anything else — Google's callback, a create outside a
 * request — needs the mark the before-hook put into the state.
 */
async function isAgeCheckedForCreate(
  context: HookRequest | null,
): Promise<boolean> {
  if (context === null) return false;
  if (context.path === "/sign-up/email") return true;
  const state = await serverContext();
  return state?.ageChecked === true;
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
    if (gate.checksAge && !(await isAgeCheckedForCreate(context))) {
      refuseMissingAge();
    }
    if (!gate.isInviteOnly) return { data: { ...user, name: "" } };
    const code = await codeForCreate(context);
    if (code === undefined) refuse("missing");
    const id = newUlid();
    const claimed = await gate.claim({ code, userId: id, email: user.email });
    if (claimed !== "redeemed") refuse("invalid");
    return { data: { ...user, id, name: "" } };
  };
}
