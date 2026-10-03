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

export const returnPathSchema = z
  .string()
  .startsWith("/")
  .refine((path) => !CONTROL.test(path) && !ENCODED_SEPARATOR.test(path))
  .refine(isOnSite)
  .refine((path) => !path.startsWith("/auth"));
