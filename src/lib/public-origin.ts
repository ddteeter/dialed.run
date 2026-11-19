/**
 * The production origin, which an `og:image` must be absolute against —
 * previews fetch it from outside, with no page to resolve a path against.
 * The same value as `wrangler.jsonc`'s `BETTER_AUTH_URL`, which a route
 * cannot read; `test/bindings-conformance.test.ts` fails if they differ.
 *
 * In `lib` because `modules/ops/sentry` reads it and must import nothing
 * in `ops` (design 240, knot 2), and the document head and the public
 * routes read it too.
 */
export const PUBLIC_ORIGIN = "https://app.dialed.run";
