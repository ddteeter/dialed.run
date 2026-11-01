/**
 * The headers a public page leaves with (design 163, D-154): what lets the
 * edge keep it, and the tags a purge names it by.
 *
 * **Only the open web's responses carry these.** A public page is safe to
 * store because it never varies by viewer: the same bytes for everyone,
 * signed in or not. Every other response the Worker generates leaves with
 * `private, no-store` unless it names its own (`withSecurityHeaders`):
 * with Workers Caching on, a response with no `Cache-Control` is stored by
 * RFC 9111's heuristic freshness, and a request's `Cookie` is not in the
 * cache key (design 163, "Deviations (CSP)").
 *
 * **The TTL is the guarantee; a purge only shortens it.** A retracted kit
 * is gone from the edge within `PUBLIC_PAGE_TTL_SECONDS` whatever else
 * fails. The tags (`lib/cache-tags.ts`) are what a purge by tag names:
 * the writers that take a page back purge them through `./edge-purge.ts`.
 */
import { runnerCacheTag } from "../../lib/cache-tags";

/**
How long the edge may keep a public page or its not-public twin.
*/
export const PUBLIC_PAGE_TTL_SECONDS = 60;

/**
 * `Cache-Control: public` for `ttlSeconds`, and the `Cache-Tag` list when
 * there are tags to name.
 */
export function publicCacheHeaders(
  ttlSeconds: number,
  tags: readonly string[],
): Record<string, string> {
  const cacheControl = {
    "Cache-Control": `public, max-age=${String(ttlSeconds)}`,
  };
  return tags.length === 0
    ? cacheControl
    : { ...cacheControl, "Cache-Tag": tags.join(",") };
}

/**
 * A public page's tags: its own (the kit's, the handle's path) when its
 * path names one, and its runner's when the page is public.
 */
export function publicPageTags(
  pageTag: string | undefined,
  runnerId: string | undefined,
): string[] {
  const page = pageTag === undefined ? [] : [pageTag];
  const runner = runnerId === undefined ? [] : [runnerCacheTag(runnerId)];
  return [...page, ...runner];
}

/**
 * A public page's cache headers (design 163, D-154): a minute at the edge,
 * public or not, tagged as above. The kit's page and the profile's both
 * leave with these, so the two cannot drift apart.
 */
export function publicPageHeaders(
  pageTag: string | undefined,
  runnerId: string | undefined,
): Record<string, string> {
  return publicCacheHeaders(
    PUBLIC_PAGE_TTL_SECONDS,
    publicPageTags(pageTag, runnerId),
  );
}

/**
 * Whether the edge may store `response` and hand it to the next visitor:
 * its `Cache-Control` says `public`. What drops its cookie (below) and
 * admits its inline scripts by hash rather than nonce (`./secure-response`).
 */
export function isPubliclyStorable(response: Response): boolean {
  const directives = String(response.headers.get("Cache-Control")).split(",");
  return directives.some(
    (directive) => directive.trim().toLowerCase() === "public",
  );
}

/**
 * A response the edge may store never sets a cookie: a stored
 * `Set-Cookie` would be handed to every later visitor. The one cookie a
 * public page could pick up is the D1 bookmark (`d1b`, design 143), which
 * only saves the device a stale read later; it is dropped rather than
 * shared. Anything not public is returned as it came.
 */
export function withoutCookiesWhenPublic(response: Response): Response {
  if (!isPubliclyStorable(response)) return response;
  const stripped = new Response(response.body, response);
  stripped.headers.delete("Set-Cookie");
  return stripped;
}
