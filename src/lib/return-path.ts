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

/**
 * An escape that could spell part of `auth`. A router decodes
 * `/%61uth/login` to `/auth/login` before it matches, and the URL parser
 * leaves it encoded, so the loop rule decodes before it looks. Every
 * letter of `auth`, in either case, is a two-decimal-digit escape
 * (`%41`–`%75`), so decimal digits are exactly what this needs; a slash
 * spelled `%2F` never gets here, refused as `ENCODED_SEPARATOR`.
 */
const ENCODED_BYTE = /%\d\d/gu;

function decodeLetters(pathname: string): string {
  return pathname.replaceAll(ENCODED_BYTE, (escape) =>
    String.fromCodePoint(Number.parseInt(escape.slice(1), 16)),
  );
}

/**
 * Never back into the auth pages, judged on the path a router would match
 * rather than on the spelling: `/./auth/login`, `/feed/../auth/login`,
 * `/%61uth/login` and `/AUTH/login` (TanStack matches routes
 * case-insensitively) are all log-in, and a log-in that returns to log-in
 * is a loop. A segment, not a prefix: `/authors` is somewhere else.
 */
function isAuthPage(pathname: string): boolean {
  const matched = decodeLetters(pathname).toLowerCase();
  return matched === "/auth" || matched.startsWith("/auth/");
}

/**
 * The path a router would land on, or `undefined` when that is not
 * somewhere log-in may send a runner.
 *
 * **The normalised path is what is kept, never the spelling it came in.**
 * `/.//evil.example/x` resolves on this origin, but to the pathname
 * `//evil.example/x` — and handed raw to anything that builds a
 * `Location` from it, that is protocol-relative. So the resolved pathname
 * is judged, a leading `//` is refused, and what comes back is the
 * resolved `pathname + search`. A path the parser cannot resolve at all
 * (`//` with no host) is refused too, rather than thrown.
 */
function resolveOnSite(path: string): string | undefined {
  if (!URL.canParse(path, ORIGIN)) return undefined;
  const url = new URL(path, ORIGIN);
  if (url.origin !== ORIGIN) return undefined;
  if (url.pathname.startsWith("//")) return undefined;
  if (isAuthPage(url.pathname)) return undefined;
  return `${url.pathname}${url.search}`;
}

/**
 * Longer than any page on this site, and short enough that a way back is
 * never a payload.
 */
const MAX_RETURN_PATH = 2048;

export const returnPathSchema = z
  .string()
  .max(MAX_RETURN_PATH)
  .startsWith("/")
  .refine((path) => !CONTROL.test(path) && !ENCODED_SEPARATOR.test(path))
  // A refused path resolves to `undefined`, which the pipe turns away.
  .transform(resolveOnSite)
  .pipe(z.string());

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
