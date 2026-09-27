import { redirect } from "@tanstack/react-router";

import {
  isRememberedForSession,
  rememberForSession,
} from "../../lib/session-memo";
import type { HandleGate } from "./username";

/**
 * The pages a signed-in runner with no handle may still reach: O0 itself,
 * or the redirect would loop, and the pages an email link opens —
 * confirming an address, resetting a password, unsubscribing — which
 * finish something the runner started elsewhere and must not need a
 * handle first.
 */
const OPEN_WITHOUT_HANDLE: ReadonlySet<string> = new Set([
  "/onboarding/handle",
  "/account/check-email",
  "/account/verify",
  "/account/reset",
  "/account/unsubscribe",
]);

/**
 * …and the auth pages: signing out, or finishing what a sign-in started,
 * must not need a handle first.
 */
function isOpenWithoutHandle(pathname: string): boolean {
  return OPEN_WITHOUT_HANDLE.has(pathname) || pathname.startsWith("/auth/");
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

/**
 * The fact the browser remembers once it has heard it (`lib/session-memo`).
 */
const HANDLE_CLAIMED = "has-handle";

/**
 * The root route's `beforeLoad`: ask whether this visitor needs O0, and
 * send them there if so.
 *
 * **Asked once per session in the browser, not on every navigation.**
 * The question is a server round trip, and it used to be paid before
 * every page. Its one answer that cannot change while the session lasts
 * is "has a handle" — a handle is renamed, never cleared — so the browser
 * keeps that one and skips the trip afterwards. The other two answers are
 * asked again each time: "signed out" and "no handle yet" both end the
 * moment the runner signs in or claims one. Signing in or out forgets the
 * memo (`auth/credentials`).
 *
 * `isInBrowser` is the caller's to say, because on the server the memo
 * would be shared by every request the isolate serves.
 */
export async function gateOnHandle({
  ask,
  pathname,
  isInBrowser,
}: Readonly<{
  ask: () => Promise<HandleGate>;
  pathname: string;
  isInBrowser: boolean;
}>): Promise<void> {
  if (isInBrowser && isRememberedForSession(HANDLE_CLAIMED)) return;
  const gate = await ask();
  if (isInBrowser && gate === "has-handle") rememberForSession(HANDLE_CLAIMED);
  startHandleIfNeeded(gate === "needs-handle", pathname);
}
