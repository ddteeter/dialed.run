import { AUTH_COPY, AuthRejected } from "./auth-copy";
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
 * Better Auth's answer to a sign-up for an address that already has an
 * account.
 */
const EMAIL_TAKEN = "USER_ALREADY_EXISTS_USE_ANOTHER_EMAIL";

/**
 * The one refusal each form lands on a field, keyed by form: everything
 * else Better Auth says is the band's.
 */
const FIELD_REFUSALS = {
  signIn: {
    code: UNKNOWN_CREDENTIALS,
    field: "password",
    message: AUTH_COPY.wrongPassword,
  },
  signUp: { code: EMAIL_TAKEN, field: "email", message: AUTH_COPY.emailTaken },
} as const;

/**
 * Better Auth's `{ error }` answer, thrown as the failure the form draws:
 * the form's one field refusal on its field, anything else for the band.
 */
function throwIfRefused(
  error: ClientError | null | undefined,
  refusal: (typeof FIELD_REFUSALS)[keyof typeof FIELD_REFUSALS],
): void {
  if (!error) return;
  throw error.code === refusal.code
    ? new AuthFieldError(refusal.field, refusal.message)
    : new AuthRejected(error.status);
}

interface SignInValues {
  email: string;
  password: string;
}

interface SignUpValues extends SignInValues {
  name: string;
}

export async function signIn(values: SignInValues): Promise<void> {
  const { error } = await authClient.signIn.email(values);
  throwIfRefused(error, FIELD_REFUSALS.signIn);
}

export async function signUp(values: SignUpValues): Promise<void> {
  const { error } = await authClient.signUp.email(values);
  throwIfRefused(error, FIELD_REFUSALS.signUp);
}

/**
 * Signs out, as a promise that rejects — so the settings index's Sign out
 * can say "Still signed in" rather than announce a sign-out that did not
 * happen.
 */
export async function signOut(): Promise<void> {
  const { error } = await authClient.signOut();
  if (error) throw new AuthRejected(error.status);
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
): Promise<string> {
  const result = await authClient.signIn.social({
    provider: "google",
    callbackURL,
    errorCallbackURL,
    disableRedirect: true,
  });
  if (result.error) throw new AuthRejected(result.error.status);
  // Optional in Better Auth's type because its id-token flow answers
  // without one; the redirect flow always has it, and an answer without it
  // is a failed attempt rather than a trip to nowhere.
  const { url } = result.data;
  if (url === undefined) throw new Error("no consent URL in Google's answer");
  return url;
}
