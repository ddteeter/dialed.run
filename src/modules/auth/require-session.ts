/**
 * The route-loader half of the auth gate's decision.
 *
 * Loaders want a redirect, not a thrown error — `requireUserId` is the
 * server-function half. Both exist so no route hand-rolls `getSession()` +
 * `redirect()`, which is how lane 101 and lane 104 ended up with two
 * different idioms and one route that bypassed the module entirely.
 *
 * Separate from ./functions for the same reason ./session-user is separate
 * from ./require-user: `@tanstack/react-router` resolves inside the vitest
 * workers pool and `@tanstack/react-start` does not, so keeping the
 * decision out of the file that calls `createServerFn` is what makes it
 * testable at all.
 */
import { redirect } from "@tanstack/react-router";

/**
 * The session, or a redirect to sign-in. Returns a non-null session so a
 * loader can use the result directly instead of re-narrowing after the
 * guard.
 */
export function sessionOrRedirect<Session>(session: Session | null): Session {
  if (session === null) {
    // `throw: true` is TanStack's own throwing form. A bare
    // `throw redirect(...)` trips @typescript-eslint/only-throw-error,
    // because what it returns is a Redirect, not an Error.
    redirect({ to: "/auth/login", throw: true });
    // Unreachable: the call above throws. It exists so the compiler can
    // narrow `session`, since `redirect` is typed as returning a Redirect
    // rather than `never` — which is also why nothing can read this
    // message.
    // Stryker disable next-line StringLiteral,CallExpression
    throw new Error("unreachable: redirect({ throw: true }) returned");
  }
  return session;
}
