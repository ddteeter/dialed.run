/**
 * The headers a public page leaves with (design 160, D-152): what lets the
 * edge keep it, and the tags a purge names it by.
 *
 * **Only the open web's responses carry these.** Every other response the
 * Worker generates keeps today's headers (no `Cache-Control` at all), so a
 * page that varies by viewer can never be stored and served to someone
 * else. A public page is safe to store because it never varies by viewer:
 * the same bytes for everyone, signed in or not.
 *
 * **The TTL is the guarantee; a purge only shortens it.** A retracted kit
 * is gone from the edge within `PUBLIC_PAGE_TTL_SECONDS` whatever else
 * fails. The tags are what a purge by tag would name (`entry:<id>`,
 * `runner:<userId>`); nothing purges yet (design 160, step 6).
 */

/**
How long the edge may keep a public page or its not-public twin.
*/
export const PUBLIC_PAGE_TTL_SECONDS = 60;

/**
The tag naming one kit's page and card.
*/
export function entryCacheTag(entryId: string): string {
  return `entry:${entryId}`;
}

/**
 * The tag naming everything a runner has on the open web, so one purge
 * covers a ban, a leaving or a handle change.
 */
export function runnerCacheTag(userId: string): string {
  return `runner:${userId}`;
}

/**
 * `Cache-Control: public` for `ttlSeconds`, and the `Cache-Tag` list when
 * there are tags to name.
 */
export function publicCacheHeaders(
  ttlSeconds: number,
  tags: readonly string[],
): Record<string, string> {
  const cacheControl = { "Cache-Control": `public, max-age=${String(ttlSeconds)}` };
  return tags.length === 0
    ? cacheControl
    : { ...cacheControl, "Cache-Tag": tags.join(",") };
}

/**
 * A response the edge may store never sets a cookie: a stored
 * `Set-Cookie` would be handed to every later visitor. The one cookie a
 * public page could pick up is the D1 bookmark (`d1b`, design 143), which
 * only saves the device a stale read later; it is dropped rather than
 * shared. Anything not public is returned as it came.
 */
export function withoutCookiesWhenPublic(response: Response): Response {
  const directives = String(response.headers.get("Cache-Control")).split(",");
  const isStorable = directives.some(
    (directive) => directive.trim().toLowerCase() === "public",
  );
  if (!isStorable) return response;
  const stripped = new Response(response.body, response);
  stripped.headers.delete("Set-Cookie");
  return stripped;
}
