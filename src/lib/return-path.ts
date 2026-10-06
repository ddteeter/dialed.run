/**
 * A way back, carried in a URL: a path on this site, and never the auth
 * pages themselves. Log-in's `redirect` (`modules/auth/sign-in-search`)
 * and the terms prompt's `from` (`modules/account/route-decisions`, ACC-6)
 * both read one, so the rule lives here rather than in either module.
 */
import { z } from "zod";

/**
 * **Same-origin by resolution, not by spelling**, because an open redirect
 * on a log-in page is the textbook phishing aid. A pattern over the raw
 * string cannot keep up with what a URL parser forgives: `//evil.example`
 * is protocol-relative, `/\evil.example` is the same once a browser
 * normalises the backslash, and `/\t/evil.example` is the same again once
 * the parser strips the tab. So the path is resolved against an origin
 * and kept only if it is still on that origin — and, before that, anything
 * a parser would quietly rewrite is refused outright: control characters,
 * and slashes or backslashes spelled as escapes.
 */
const ORIGIN = "https://dialed.invalid";

/**
 * Tab, newline and every other control character (Unicode's `Cc`: C0, DEL
 * and C1), all of which a URL parser strips, rejects or percent-encodes.
 */
const CONTROL = /\p{Cc}/u;

/**
`%2F` and `%5C`: a slash or backslash the parser would decode into one.
*/
const ENCODED_SEPARATOR = /%(?:2f|5c)/iu;

function isOnSite(path: string): boolean {
  return new URL(path, ORIGIN).origin === ORIGIN;
}

/**
 * Never back into the auth pages, judged on the path a router would match
 * rather than on the spelling: `/./auth/login`, `/feed/../auth/login` and
 * `/AUTH/login` (TanStack matches routes case-insensitively) are all
 * log-in, and a log-in that returns to log-in is a loop.
 */
function isOutsideAuth(path: string): boolean {
  return !new URL(path, ORIGIN).pathname.toLowerCase().startsWith("/auth");
}

export const returnPathSchema = z
  .string()
  .startsWith("/")
  .refine((path) => !CONTROL.test(path) && !ENCODED_SEPARATOR.test(path))
  .refine(isOnSite)
  .refine(isOutsideAuth);

/**
 * Where a sign-in lands when no way back was carried, or the one carried
 * was refused: home, which sends a signed-in runner on to their feed.
 */
export const DEFAULT_LANDING = "/";

/**
 * The page a gate is turning someone away from, as log-in's way back:
 * path and search — never the origin, and never the hash, which no server
 * ever sees. `undefined` when that is not somewhere log-in may return to
 * (an auth page, say), so no gate ever writes one into a URL.
 *
 * Every redirect to log-in takes its `redirect` from here — the loader
 * gates (`modules/auth`'s `requireSession`, `modules/feed`'s
 * `requireSignedIn`) and the router's lapsed-session screen — so the rule
 * for "what counts as the current page" is written once.
 */
export function returnPathOf(
  location: Readonly<{ pathname: string; searchStr: string }>,
): string | undefined {
  const parsed = returnPathSchema.safeParse(
    `${location.pathname}${location.searchStr}`,
  );
  return parsed.success ? parsed.data : undefined;
}

/**
 * Where a sign-in goes, decided at the point of use: the carried way back
 * if it is still a path on this site outside the auth pages, and
 * otherwise `DEFAULT_LANDING`. Every way in calls it — password, Google —
 * however the value reached them, so a hostile `redirect` falls back to
 * home rather than leaving the site.
 */
export function landingAfterSignIn(redirect: unknown): string {
  const parsed = returnPathSchema.safeParse(redirect);
  return parsed.success ? parsed.data : DEFAULT_LANDING;
}
