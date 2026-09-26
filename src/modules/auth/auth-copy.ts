import type { FormFailure } from "../../ui";

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
  Au3's one exception, on Email, at Create account.
  */
  emailTaken: "There's already an account with this email. Log in?",
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
} as const;

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
 * The band's sentence for a failed submit, or nothing when there is no
 * band to show.
 */
export function authFailureMessage(
  failure: FormFailure | undefined,
  cause: unknown,
): string | undefined {
  if (failure === undefined) return undefined;
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
  bandMessage,
  googleFailed,
}: Readonly<{
  status: string;
  bandMessage: string | undefined;
  googleFailed: boolean;
}>): string {
  if (bandMessage !== undefined) return `${AUTH_KICKER}. ${bandMessage}`;
  if (googleFailed) return `${AUTH_KICKER}. ${AUTH_COPY.google}`;
  return status.startsWith(CONTRACT_OPENER)
    ? `${AUTH_KICKER}.${status.slice(CONTRACT_OPENER.length)}`
    : status;
}
