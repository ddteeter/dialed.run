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
