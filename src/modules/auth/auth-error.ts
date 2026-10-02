/**
 * The unauthenticated signal, with no TanStack import.
 *
 * Deliberately separate from ./require-user: anything that pulls
 * `@tanstack/react-start/server` drags the framework's virtual entries in
 * with it, and those cannot resolve inside the vitest workers pool. Keeping
 * the error here means the type and its guard stay unit-testable, which
 * matters more for them than for the session lookup they accompany.
 */

import { AUTH_REQUIRED_CODE } from "../../lib/auth-signal";

/**
 * The single unauthenticated signal.
 *
 * `instanceof` is deliberately NOT the detection mechanism: a server
 * function's thrown error is serialised across the RPC boundary, so the
 * prototype is gone by the time a route or component sees it. `code` is a
 * plain own property and survives that trip, which is what `isAuthRequired`
 * checks. Use the guard, never `instanceof`, on anything that came back
 * from a server function.
 */
export class AuthRequiredError extends Error {
  readonly code = AUTH_REQUIRED_CODE;

  constructor() {
    super("Sign in required.");
    this.name = "AuthRequiredError";
  }
}

// The guard lives in lib/ so `ui/` can use it too — it may not import
// modules, and the alternative was matching the message text with a regex.
export { AUTH_REQUIRED_CODE, isAuthRequired } from "../../lib/auth-signal";

/**
 * The code a leaving runner's refusal carries: `requireUserId` saying no
 * to a runner whose account is set to be deleted (task 126, ACC-9). A
 * code of its own rather than `AUTH_REQUIRED`, because the runner *is*
 * signed in — "You were signed out" would send them to a log-in page that
 * sends them straight back.
 */
const ACCOUNT_LEAVING_CODE = "ACCOUNT_LEAVING";

/**
 * A signed-in runner whose account is set to be deleted, asking a server
 * function to do something. Their one way on is "Keep your account?",
 * which the root route already puts in front of them; this is the server
 * saying so to a client that went round it.
 */
export class AccountLeavingError extends Error {
  readonly code = ACCOUNT_LEAVING_CODE;

  constructor() {
    super("This account is set to be deleted.");
    this.name = "AccountLeavingError";
  }
}

/**
 * The code a runner behind on the terms is refused with (task 126,
 * ACC-6): `requireUserId` saying no to a write from a runner whose latest
 * acceptance is below the current terms. Its own code, as the leaving
 * refusal's is, because the runner is signed in — "You were signed out"
 * would be untrue.
 */
const TERMS_NOT_ACCEPTED_CODE = "TERMS_NOT_ACCEPTED";

/**
 * A signed-in runner who has not accepted the current terms, asking a
 * server function to write. Their way on is the terms prompt, which the
 * root route already puts in front of them; this is the server saying so
 * to a client that went round it.
 */
export class TermsNotAcceptedError extends Error {
  readonly code = TERMS_NOT_ACCEPTED_CODE;

  constructor() {
    super("Accept the current terms first.");
    this.name = "TermsNotAcceptedError";
  }
}
