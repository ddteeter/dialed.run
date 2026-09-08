/**
 * The unauthenticated signal, with no TanStack import.
 *
 * Deliberately separate from ./require-user: anything that pulls
 * `@tanstack/react-start/server` drags the framework's virtual entries in
 * with it, and those cannot resolve inside the vitest workers pool. Keeping
 * the error here means the type and its guard stay unit-testable, which
 * matters more for them than for the session lookup they accompany.
 */

const AUTH_REQUIRED_CODE = "AUTH_REQUIRED";

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

/**
 * True for an `AuthRequiredError` raised in this isolate *and* for the
 * structurally-cloned shape a server-function call rejects with.
 */
export function isAuthRequired(error: unknown): boolean {
  if (typeof error !== "object" || error === null) return false;
  if (!("code" in error)) return false;
  return error.code === AUTH_REQUIRED_CODE;
}
