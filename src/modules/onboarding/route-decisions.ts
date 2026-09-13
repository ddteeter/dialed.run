import { redirect } from "@tanstack/react-router";

/**
 * The one decision `/` makes about onboarding, where a test can reach it.
 *
 * A route file imports a module's `functions.ts` and so cannot be imported
 * by any test — which makes a `beforeLoad` the one place in this codebase
 * a decision cannot be checked. Same shape as `feed/redirect.ts` and
 * `auth/require-session.ts`, and the same reason: `@tanstack/react-router`
 * resolves inside the vitest workers pool while `@tanstack/react-start`
 * does not, so keeping the branch out of the file that calls
 * `createServerFn` is what makes it testable at all.
 */
export function startOnboardingIfNeeded(isUnfinished: boolean): void {
  if (isUnfinished) {
    // `throw: true` is TanStack's own throwing form; a bare `throw
    // redirect(...)` trips `only-throw-error`, because what it returns is a
    // Redirect rather than an Error.
    redirect({ to: "/onboarding/calibrate", throw: true });
  }
}
