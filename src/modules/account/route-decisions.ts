import { redirect } from "@tanstack/react-router";

/**
 * `/`'s first decision about a signed-in runner: no handle yet means O0,
 * before O1 or anything else (round 26 #7 — "Everyone, email or Google,
 * picks a handle at O0, the first step of onboarding").
 *
 * Here rather than in the route for the reason `onboarding/route-decisions`
 * gives: a route file cannot be imported by a test, and this can.
 */
export function startHandleIfNeeded(requiresHandle: boolean): void {
  if (requiresHandle) {
    // `throw: true` is TanStack's own throwing form; a bare `throw
    // redirect(...)` trips `only-throw-error`.
    redirect({ to: "/onboarding/handle", throw: true });
  }
}
