import {
  ACCESS_CODES,
  INVITE_COPY,
  TURNSTILE_REFUSED,
} from "../../lib/contracts/access";
import { CURRENT_PASSWORD_WRONG } from "../../lib/contracts";
import type { ControlFailure, FormFailure } from "../../ui";

/**
 * Every sentence the two auth forms say about a failure, from the Auth
 * board (round 22, items 1–2), in one place.
 *
 * These are the server's answers put into words, so there is no schema to
 * hold them — the schema's messages are for what the form can check
 * before the round trip ("Enter your password."), and these are for what
 * only the server knows. One table rather than a sentence at each throw
 * site, so the page and its tests read the same string.
 */
export const AUTH_COPY = {
  /**
   * Au3. *"One message, never 'email or password is wrong' split across
   * two fields"* — and an unknown email reads the same sentence on
   * Password, so the form never confirms which emails have accounts.
   */
  wrongPassword: "That password doesn't match this email.",
  /**
   * The breach screen's refusal, on Password (NIST SP 800-63B §3.1.1.2).
   * Placeholder copy until design words it (design-deltas).
   */
  passwordBreached:
    "That password has turned up in a data breach. Pick another.",
  /**
   * ACC-7: the current password, when it is not the account's. Placeholder
   * copy, the log-in refusal's shape (design deltas).
   */
  currentPasswordWrong: CURRENT_PASSWORD_WRONG,
  /**
  Au4, a server fault.
  */
  server: "Our end failed. Try again in a moment.",
  /**
  Au4: *"Rate limit is a form failure too … no countdown."*
  */
  rateLimited: "Too many tries. Wait a minute, then try again.",
  /**
  Au4: the connection line, the Form Contract's own.
  */
  network: "Your connection dropped.",
  /**
  Au6, the band that belongs to the Google button.
  */
  google: "Google didn't answer. Try again, or use your email.",
  /**
   * Google from the log-in page, for an address with no account: Better
   * Auth refuses to make one there (`disableImplicitSignUp`), because an
   * account is made on Au2, with a code (round 28 #9, confirmed).
   */
  googleNoAccount: "No account uses that Google address. Create one first.",
  /**
  Round 28 #9: Google on Au2 with the code field empty.
  */
  googleNoCode: "Enter your invite code above, then continue with Google.",
} as const;

/**
 * Round 27 #12: a Turnstile refusal is `NOT SENT`, on Au2 and Au5 alike —
 * nothing reached the server's decision, so "not signed in" would be the
 * wrong fact.
 */
export const NOT_SENT = "Not sent";

/**
 * Round 28 #9's kickers for Google's refusals: Au2's account was not
 * made, Au1's runner was not logged in.
 */
export const NOT_CREATED = "Not created";
export const NOT_LOGGED_IN = "Not logged in";

/**
Where a refusal's band points, when its fix is on another page.
*/
export type RefusalLink = "request-access" | "create-account";

/**
 * A band about the way in. `retry` is false for a refusal whose fix is
 * not pressing again — the code field above, or another page, which
 * `link` names — so its band carries no Try again (round 28 #9).
 */
export interface AuthBand extends ControlFailure {
  readonly retry?: false | undefined;
  readonly link?: RefusalLink | undefined;
}

/**
 * A refusal the way in made (ACC-5) that belongs in a band rather than on
 * a field: Turnstile's on the form, and every refusal on Au2's Google
 * button — whose band is the only place its failure can be said (Au6).
 */
export class AccessRefused extends Error implements AuthBand {
  readonly kicker: string;
  readonly retry: false | undefined;
  readonly link: RefusalLink | undefined;

  constructor(band: AuthBand) {
    super(band.message);
    this.name = "AccessRefused";
    this.kicker = band.kicker;
    this.retry = band.retry;
    this.link = band.link;
  }
}

/**
 * Better Auth's answer when Google would have made an account from the
 * log-in page, which only Au2 may do (ACC-5).
 */
export const SIGNUP_DISABLED = "signup_disabled";

/**
 * Google's refusals, by the code that names them, as round 28 #9 draws
 * them in a band under the button: no code ("enter it above"), a refused
 * code (the field's sentence, and Request access), and Au1's address with
 * no account (Create an account). None offers Try again.
 */
export const GOOGLE_REFUSALS: ReadonlyMap<string | undefined, AuthBand> =
  new Map([
    [
      ACCESS_CODES.missing,
      { kicker: NOT_CREATED, message: AUTH_COPY.googleNoCode, retry: false },
    ],
    [
      ACCESS_CODES.invalid,
      {
        kicker: NOT_CREATED,
        message: INVITE_COPY.invalid,
        retry: false,
        link: "request-access",
      },
    ],
    [
      SIGNUP_DISABLED,
      {
        kicker: NOT_LOGGED_IN,
        message: AUTH_COPY.googleNoAccount,
        retry: false,
        link: "create-account",
      },
    ],
  ]);

/**
Turnstile's refusal, as a band says it.
*/
export function turnstileRefused(): AccessRefused {
  return new AccessRefused({ kicker: NOT_SENT, message: TURNSTILE_REFUSED });
}

/**
 * *"'Not signed in', not 'Nothing saved'. Auth saves nothing, so the
 * contract's opener would be false. Same block, same place, same Try
 * again. This is the only form that changes the two words."*
 */
export const AUTH_KICKER = "Not signed in";

/**
 * What the server said, kept by the form so the band can name it.
 *
 * `useFormSubmit` classifies a throw into network / server / session and
 * nothing finer, which is right for every other form and one short here:
 * Au4 tells a rate limit apart from a fault. The status is the one extra
 * fact, and it travels on the error rather than through a second channel.
 */
export class AuthRejected extends Error {
  readonly status: number;

  constructor(status: number) {
    super(`auth rejected with status ${String(status)}`);
    this.name = "AuthRejected";
    this.status = status;
  }
}

/**
 * The band for a failed submit — its kicker and its sentence — or nothing
 * when there is no band to show.
 */
export function authFailure(
  failure: FormFailure | undefined,
  cause: unknown,
): AuthBand | undefined {
  if (failure === undefined) return undefined;
  if (cause instanceof AccessRefused) return cause;
  return { kicker: AUTH_KICKER, message: authFailureMessage(failure, cause) };
}

function authFailureMessage(failure: FormFailure, cause: unknown): string {
  if (failure.kind === "network") return AUTH_COPY.network;
  return cause instanceof AuthRejected && cause.status === 429
    ? AUTH_COPY.rateLimited
    : AUTH_COPY.server;
}

/**
The Form Contract's opener, as `useFormSubmit` announces it.
*/
const CONTRACT_OPENER = "Nothing saved.";

/**
 * The screen's one status sentence, with the auth opener.
 *
 * `useFormSubmit` announces "Nothing saved. One field needs a fix." — the
 * Form Contract's opener, which the Auth board replaces for these two
 * forms only (Au3: *"Status region: 'Not signed in. One field needs a
 * fix.'"*). A band's sentence is the band's own, so the region and the
 * block say the same words — and the screen has one region, so Google's
 * band (Au6) speaks through it too, after the form's own if both failed.
 */
export function authStatus({
  status,
  band,
  google,
}: Readonly<{
  status: string;
  band: ControlFailure | undefined;
  google: ControlFailure | undefined;
}>): string {
  const said = band ?? google;
  if (said !== undefined) return `${said.kicker}. ${said.message}`;
  return status.startsWith(CONTRACT_OPENER)
    ? `${AUTH_KICKER}.${status.slice(CONTRACT_OPENER.length)}`
    : status;
}
