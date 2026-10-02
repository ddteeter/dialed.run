import { redirect } from "@tanstack/react-router";
import { z } from "zod";

import {
  isRememberedForSession,
  noteSessionOwner,
  rememberForSession,
} from "../../lib/browser/session-memo";
import type { LeavingView } from "./deletion";
import type { TermsPromptView } from "./terms-acceptance";
import type { LegalDoc } from "./legal-markdown";
import type { HandleGateAnswer } from "./username";

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
  "/privacy",
  "/terms",
  "/copyright",
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
 * The fact the browser remembers once it has heard it (`lib/browser/session-memo`).
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
 * memo (`auth/credentials`), and the memo is keyed to the runner the
 * server named, so a switch of account in another tab is asked about too.
 *
 * `isInBrowser` is the caller's to say, because on the server the memo
 * would be shared by every request the isolate serves.
 */
export async function gateOnHandle({
  ask,
  pathname,
  isInBrowser,
}: Readonly<{
  ask: () => Promise<HandleGateAnswer>;
  pathname: string;
  isInBrowser: boolean;
}>): Promise<void> {
  if (isInBrowser && isRememberedForSession(HANDLE_CLAIMED)) return;
  const answer = await ask();
  if (isInBrowser) noteSessionOwner(answer.userId);
  if (isInBrowser && answer.gate === "has-handle") {
    rememberForSession(answer.userId, HANDLE_CLAIMED);
  }
  startLeavingIfNeeded(answer.gate === "leaving", pathname);
  startTermsIfNeeded(answer.gate === "needs-terms", pathname);
  startHandleIfNeeded(answer.gate === "needs-handle", pathname);
}

/**
 * The pages a runner whose account is being deleted may still reach
 * (ACC-9; round 27 #14): "Keep your account?" itself, the auth pages —
 * Log out is how they leave it as it was — and the privacy policy.
 */
const OPEN_WHILE_LEAVING: ReadonlySet<string> = new Set([
  "/account/leaving",
  "/privacy",
  "/terms",
  "/copyright",
]);

/**
 * A runner who asked to delete their account and signed in again inside
 * the week sees "Keep your account?" before anything else: logging in
 * never cancels a deletion silently (round 27 #14).
 */
export function startLeavingIfNeeded(
  isLeaving: boolean,
  pathname: string,
): void {
  if (
    isLeaving &&
    !OPEN_WHILE_LEAVING.has(pathname) &&
    !pathname.startsWith("/auth/")
  ) {
    redirect({ to: "/account/leaving", throw: true });
  }
}

/**
 * The pages a runner who is behind on the terms may still reach (ACC-6):
 * the prompt itself; the texts it asks them to read; Settings › Account,
 * where Delete account is, since a runner who will not accept must still
 * be able to leave; the pages an email link opens, which finish something
 * started elsewhere; and the auth pages, Log out among them. Not O0: a
 * handle is claimed through a server function, which refuses them.
 */
const OPEN_WHILE_BEHIND: ReadonlySet<string> = new Set([
  "/account/terms",
  "/terms",
  "/privacy",
  "/copyright",
  "/account/sign-in",
  "/account/check-email",
  "/account/verify",
  "/account/reset",
  "/account/unsubscribe",
]);

/**
 * A runner whose latest acceptance is below the current terms sees the
 * terms prompt before anything else, as a leaving runner sees "Keep your
 * account?".
 */
export function startTermsIfNeeded(isBehind: boolean, pathname: string): void {
  if (
    isBehind &&
    !OPEN_WHILE_BEHIND.has(pathname) &&
    !pathname.startsWith("/auth/")
  ) {
    redirect({ to: "/account/terms", throw: true });
  }
}

/**
 * A link's search, as it arrives: whatever is there, strings or nothing.
 * Anything else — a repeated param, an edited URL — is dropped rather than
 * failing the page, which then says the link has run out.
 */
const optionalText = z.string().optional().catch(undefined);

/**
Au4's search: the address sign-up sent the link to.
*/
export const checkEmailSearch = z.object({ email: optionalText });

/**
 * A token link's search — the confirm link's and the reset link's.
 */
export const tokenSearch = z.object({ token: optionalText });

/**
 * The unsubscribe link's search, kept whole: its signature is checked on
 * the server, and a page that dropped a param here would call a good link
 * bad.
 */
export const unsubscribeSearch = z.object({
  u: optionalText,
  k: optionalText,
  s: optionalText,
});

/**
 * Au4 with nobody to be about — signed out, and no address from sign-up —
 * has nothing to say, so it is sign-up again.
 */
export function startOverIfNoAddress(
  account: { email: string } | undefined,
  searchEmail: string | undefined,
): void {
  if (account === undefined && (searchEmail ?? "") === "") {
    redirect({ to: "/auth/signup", throw: true });
  }
}

/**
 * Who Au4 is about. Signed in (back through "Log in to resend"), it is the
 * runner's own address; signed out, it is the address sign-up just sent
 * to.
 */
export function checkEmailView(
  account: { email: string } | undefined,
  searchEmail: string,
): { email: string; isSignedIn: boolean } {
  return {
    email: account?.email ?? searchEmail,
    isSignedIn: account !== undefined,
  };
}

/**
 * Where a Google re-authentication for deleting the account comes back
 * to (ACC-9; round 27 #14): U1 Account, with the delete sheet open again.
 */
export const DELETE_REAUTH_RETURN = "/account/sign-in?deleting=1";

/**
 * The account pages' search: only whether this load is the way back from
 * that sign-in. Anything else is ignored.
 */
export const accountSectionSearch = z.object({
  // `true` or absent, never `false`: the router writes a parsed search
  // back into the URL, and a `deleting=false` there would read as present
  // on the next load and open the sheet on every visit.
  deleting: z
    .unknown()
    .optional()
    .transform((value) =>
      value === 1 || value === "1" ? (true as const) : undefined,
    ),
});

/**
 * The account's settings pages (ACC-7, ACC-8, ACC-11), one route like
 * Settings' own sections: U1 Account ("sign-in"), and its Email and
 * Password, and Notifications. Every email footer's "Email settings" is
 * `/account/notifications`.
 */
const accountSectionSchema = z.enum([
  "sign-in",
  "email",
  "password",
  "notifications",
]);

export type AccountSection = z.infer<typeof accountSectionSchema>;

/**
 * A section this route has, or X1: an Error carrying the marker the
 * router's `isNotFound()` reads (`only-throw-error` rejects throwing
 * TanStack's plain `notFound()` object).
 */
export function accountSectionOrNotFound(section: string): AccountSection {
  const parsed = accountSectionSchema.safeParse(section);
  if (parsed.success) return parsed.data;
  throw notFound(`no account section "${section}"`);
}

/**
The heading each section's page wears.
*/
export const ACCOUNT_SECTION_TITLES: Readonly<Record<AccountSection, string>> =
  {
    "sign-in": "Account",
    email: "Email",
    password: "Password",
    notifications: "Notifications",
  };

/**
 * X1 for a page with nothing to show, by the same marker
 * `accountSectionOrNotFound` throws.
 */
function notFound(what: string): Error {
  return Object.assign(new Error(what), { isNotFound: true });
}

/**
 * A legal page's text, or X1 while the text is unfinished (`legal.ts`): a
 * page with a placeholder where the policy should be is worse than no
 * page.
 */
export function legalDocOrNotFound(doc: LegalDoc | undefined): LegalDoc {
  if (doc === undefined) throw notFound("no published legal text");
  return doc;
}

/**
 * `/account/leaving`'s search: the date a request just answered (epoch
 * seconds), for the signed-out "Your account goes on …". Anything else is
 * dropped, and the page answers as it would with none.
 */
export const leavingSearch = z.object({
  on: z.coerce.number().int().positive().optional().catch(undefined),
});

/**
 * Home, when the page has nothing to say: on `/account/leaving`, a runner
 * with no deletion pending or a signed-out visitor with no date; on
 * `/account/terms`, a runner who is current, or nobody.
 */
export function homeIfNothingToSay(
  view: LeavingView | TermsPromptView,
): void {
  if (view.state === "none") redirect({ to: "/", throw: true });
}
