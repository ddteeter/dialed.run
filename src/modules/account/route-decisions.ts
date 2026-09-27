import { redirect } from "@tanstack/react-router";

/**
 * Where a signed-in runner with no handle may still be: O0 itself, or the
 * redirect would loop, and the auth pages — signing out, or finishing
 * what a sign-in started, must not need a handle first.
 */
function isOpenWithoutHandle(pathname: string): boolean {
  return pathname === "/onboarding/handle" || pathname.startsWith("/auth/");
}

/**
 * Every page's first decision about a signed-in runner: no handle yet
 * means O0, before O1 or anything else (round 26 #7 — "Everyone, email or
 * Google, picks a handle at O0, the first step of onboarding").
 *
 * The root route asks it on every navigation, so there is no road around
 * O0: a sign-in carrying `?redirect=`, a bookmark or a typed URL all pass
 * through the root first. It used to be `/`'s alone, and a sign-in that
 * went straight to its `redirect` never met it.
 *
 * Here rather than in the route for the reason `onboarding/route-decisions`
 * gives: a route file cannot be imported by a test, and this can.
 */
export function startHandleIfNeeded(
  requiresHandle: boolean,
  pathname: string,
): void {
  if (requiresHandle && !isOpenWithoutHandle(pathname)) {
    // `throw: true` is TanStack's own throwing form; a bare `throw
    // redirect(...)` trips `only-throw-error`.
    redirect({ to: "/onboarding/handle", throw: true });
  }
}
