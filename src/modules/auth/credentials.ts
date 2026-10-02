import {
  ACCESS_CODES,
  ACCESS_HEADERS,
  INVITE_COPY,
} from "../../lib/contracts/access";
import { forgetSession } from "../../lib/browser/session-memo";
import {
  AUTH_COPY,
  AUTH_KICKER,
  AccessRefused,
  AuthRejected,
  turnstileRefused,
} from "./auth-copy";
import { BREACHED_CODE } from "./breached-password";
import { authClient } from "./client";

/**
 * Signing in and signing up, as promises that reject.
 *
 * Better Auth returns `{ error }` rather than rejecting, and
 * `useFormSubmit` classifies a *throw* into the failure band — so a
 * returned error object reads as a success and the form announces "signed
 * in" to someone who is not. Translating it is the whole job here, and
 * the translation has two outcomes (round 22, Au3 and Au4):
 *
 * - **A field failure**, thrown as a field issue `useFormSubmit` already
 *   knows how to land: the wrong password, on Password, and a taken email
 *   at Create account, on Email. *"The fix is inside the form, so it's
 *   yellow."*
 * - **A form failure** for everything else — a fault, a rate limit —
 *   carrying the status so the band can say which (`AuthRejected`).
 *
 * This lives in the module rather than in the two route files because a
 * route holds no decisions — see `test/architecture/server-functions-are-glue`.
 */

/**
 * The shape `useFormSubmit` lands on a field: `{ issues: [{ path,
 * message }] }`, read structurally. An `Error` so the throw is one.
 */
export class AuthFieldError extends Error {
  readonly issues: readonly { path: string[]; message: string }[];

  constructor(field: string, message: string) {
    super(message);
    this.name = "AuthFieldError";
    this.issues = [{ path: [field], message }];
  }
}

/**
 * Better Auth's error, as far as either form reads it. Structural, so the
 * client's own wider type is accepted without restating it.
 */
interface ClientError {
  readonly code?: string | undefined;
  readonly status: number;
}

/**
 * Au3: *"Unknown email reads the same sentence on Password — we don't
 * confirm which emails exist."* Better Auth answers both cases with this
 * one code, which is what makes that true without a branch here.
 */
const UNKNOWN_CREDENTIALS = "INVALID_EMAIL_OR_PASSWORD";

/**
 * The refusals each form lands on a field, by Better Auth's code:
 * everything else it says is the band's.
 *
 * Sign-up has one: a password the breach screen found
 * (`breached-password.ts`, NIST SP 800-63B §3.1.1.2). A taken email is no
 * longer one — Au3's exception is retired (round 26 #11), and Better Auth
 * answers a registered address exactly as a new one. Log-in has one, and
 * it is on Password whichever half was wrong.
 */
type FieldRefusals = ReadonlyMap<
  string | undefined,
  { readonly field: string; readonly message: string }
>;

const SIGN_IN_REFUSALS: FieldRefusals = new Map([
  [
    UNKNOWN_CREDENTIALS,
    { field: "password", message: AUTH_COPY.wrongPassword },
  ],
]);

const BREACHED_REFUSAL: { readonly field: string; readonly message: string } = {
  field: "password",
  message: AUTH_COPY.passwordBreached,
};

/**
Sign-up and a reset set a new password, and refuse the same one.
*/
const NEW_PASSWORD_REFUSALS: FieldRefusals = new Map([
  [BREACHED_CODE, BREACHED_REFUSAL],
]);

/**
 * Sign-up's: a breached password, and the invite code's refusals on the
 * code's own field (round 26 #20, under INVITE CODE) — a used code reads
 * as an invalid one.
 */
const SIGN_UP_REFUSALS: FieldRefusals = new Map([
  [BREACHED_CODE, BREACHED_REFUSAL],
  ...(["missing", "invalid"] as const).map(
    (refusal) =>
      [
        ACCESS_CODES[refusal],
        { field: "inviteCode", message: INVITE_COPY[refusal] },
      ] as const,
  ),
]);

/**
 * ACC-7: a wrong current password on its own field, a breached new one on
 * the new one's.
 */
const CHANGE_PASSWORD_REFUSALS: FieldRefusals = new Map([
  [
    "INVALID_PASSWORD",
    { field: "currentPassword", message: AUTH_COPY.currentPasswordWrong },
  ],
  [BREACHED_CODE, BREACHED_REFUSAL],
]);

/**
 * Better Auth's `{ error }` answer, thrown as the failure the form draws:
 * a known refusal on its field, anything else for the band.
 */
function throwIfRefused(
  error: ClientError | null | undefined,
  refusals: FieldRefusals,
): void {
  if (!error) return;
  const refusal = refusals.get(error.code);
  throw refusal === undefined
    ? new AuthRejected(error.status)
    : new AuthFieldError(refusal.field, refusal.message);
}

interface SignInValues {
  email: string;
  password: string;
}

export async function signIn(values: SignInValues): Promise<void> {
  const { error } = await authClient.signIn.email(values);
  throwIfRefused(error, SIGN_IN_REFUSALS);
  // A different runner may be signed in now: what the browser remembered
  // about the last one (`lib/browser/session-memo`) is not about them.
  forgetSession();
}

/**
 * What sign-up carries beside Better Auth's own body (ACC-5): the invite
 * code and the Turnstile token, as the headers its before-hook reads.
 */
export interface Admission {
  readonly inviteCode?: string | undefined;
  readonly turnstileToken: string | undefined;
}

function admissionHeaders({
  inviteCode,
  turnstileToken,
}: Admission): Record<string, string> {
  return {
    [ACCESS_HEADERS.inviteCode]: inviteCode ?? "",
    [ACCESS_HEADERS.turnstileToken]: turnstileToken ?? "",
  };
}

/**
 * Better Auth's `user.name` is required by its sign-up endpoint and read by
 * nothing here: a runner's name is their handle, picked at O0 (round 26 #7),
 * which lives on `user_profiles`. So it is sent empty rather than asked for,
 * and the server blanks whatever else arrives (owner, 2026-09-27).
 *
 * A Turnstile refusal is the band's, as `NOT SENT` (round 27 #12); the
 * code's refusals are the code field's.
 */
export async function signUp(
  values: SignInValues & { inviteCode?: string | undefined },
  turnstileToken: string | undefined,
): Promise<void> {
  const { error } = await authClient.signUp.email(
    { email: values.email, password: values.password, name: "" },
    {
      headers: admissionHeaders({
        inviteCode: values.inviteCode,
        turnstileToken,
      }),
    },
  );
  if (error?.code === ACCESS_CODES.turnstile) throw turnstileRefused();
  throwIfRefused(error, SIGN_UP_REFUSALS);
}

/**
 * ACC-4's request. Better Auth answers an address with no account exactly
 * as it answers one with an account, so the form can say "check your
 * inbox" to both.
 */
export async function requestPasswordReset(
  values: Readonly<{ email: string }>,
): Promise<void> {
  const { error } = await authClient.requestPasswordReset(values);
  throwIfRefused(error, new Map());
}

/**
 * The reset link's token was spent, replaced or has run out — the page's
 * "That link has run out" rather than the form's band.
 */
export class ResetLinkExpired extends Error {
  constructor() {
    super("reset link expired");
    this.name = "ResetLinkExpired";
  }
}

/**
Better Auth's answer to a spent, unknown or expired reset token.
*/
const INVALID_TOKEN = "INVALID_TOKEN";

export async function resetPassword(
  token: string,
  values: Readonly<{ password: string }>,
): Promise<void> {
  const { error } = await authClient.resetPassword({
    newPassword: values.password,
    token,
  });
  if (error?.code === INVALID_TOKEN) throw new ResetLinkExpired();
  throwIfRefused(error, NEW_PASSWORD_REFUSALS);
}

/**
 * ACC-7. Every other session ends with the old password: a change is
 * usually a runner who suspects someone else has it.
 */
export async function changePassword(
  values: Readonly<{ currentPassword: string; password: string }>,
): Promise<void> {
  const { error } = await authClient.changePassword({
    currentPassword: values.currentPassword,
    newPassword: values.password,
    revokeOtherSessions: true,
  });
  throwIfRefused(error, CHANGE_PASSWORD_REFUSALS);
}

/**
 * ACC-7's "Sign out everywhere": every session this account has, this one
 * included, so the runner lands signed out like any other sign-out.
 */
export async function signOutEverywhere(): Promise<void> {
  const { error } = await authClient.revokeSessions();
  if (error) throw new AuthRejected(error.status);
  forgetSession();
}

/**
 * Signs out, as a promise that rejects — so the settings index's Sign out
 * can say "Still signed in" rather than announce a sign-out that did not
 * happen.
 */
export async function signOut(): Promise<void> {
  const { error } = await authClient.signOut();
  if (error) throw new AuthRejected(error.status);
  forgetSession();
}

/**
 * Asks Better Auth where Google's consent screen is, without going there.
 *
 * `disableRedirect` so the caller decides whether to leave: Au5's *"tapping
 * Log in cancels the Google attempt"* means an answer can arrive for an
 * attempt the runner has already abandoned, and a redirect fired from
 * inside the client would take them anyway.
 *
 * `errorCallbackURL` is the page the attempt left from, with its own
 * search (`googleReturn`): Better Auth appends `?error=<code>` to it, and
 * the page reads that code to decide between Au6's band and — for a
 * cancelled consent, *"not an error: return to rest, silently"* — nothing.
 */
export async function googleConsentUrl(
  callbackURL: string,
  errorCallbackURL: string,
  signUp?: Admission,
): Promise<string> {
  const result = await authClient.signIn.social(
    {
      provider: "google",
      callbackURL,
      errorCallbackURL,
      disableRedirect: true,
      // Only Au2 asks to make an account, and only with its code and its
      // Turnstile token (ACC-5), checked before Google is ever asked.
      ...(signUp !== undefined && { requestSignUp: true }),
    },
    signUp === undefined ? {} : { headers: admissionHeaders(signUp) },
  );
  if (result.error) throw googleRefusal(result.error);
  // Optional in Better Auth's type because its id-token flow answers
  // without one; the redirect flow always has it, and an answer without it
  // is a failed attempt rather than a trip to nowhere.
  const { url } = result.data;
  if (url === undefined) throw new Error("no consent URL in Google's answer");
  return url;
}

/**
 * Why the Google attempt was refused, as its band says it: the way in's
 * refusals in their own words (the code's under Au2's kicker, Turnstile's
 * as `NOT SENT`), and anything else as the status it came with.
 */
function googleRefusal(error: ClientError): Error {
  if (error.code === ACCESS_CODES.turnstile) return turnstileRefused();
  const refusal = SIGN_UP_REFUSALS.get(error.code);
  return refusal?.field === "inviteCode"
    ? new AccessRefused(AUTH_KICKER, refusal.message)
    : new AuthRejected(error.status);
}
