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
 * `runner:<userId>`, `handle:<handle>`); nothing purges yet (design 160, step 6).
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
 * The tag naming the page at one handle's path, `/@<handle>`, public or
 * not (design 160): what a purge names when a profile is made public, so
 * the not-public page cached there gives way within the purge rather than
 * the TTL. It says nothing about who holds the handle, or whether anyone
 * does — the path already said the handle. `handle` is the normalized one
 * (lowercase), so `/@Maya` and `/@maya` share it.
 */
export function handleCacheTag(handle: string): string {
  return `handle:${handle}`;
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
 * A public page's cache headers (design 160, D-152): a minute at the edge,
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
