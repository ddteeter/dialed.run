/**
 * The card routes' bodies, here rather than in the route files so a test
 * can reach them (a route is glue and cannot be imported).
 */
import { PUBLIC_PAGE_TTL_SECONDS, publicCacheHeaders } from "../public-cache";
import { cardFor, type EntryCardData } from "./cards";
import { CARD_TTL_SECONDS, cachedCard, renderCard } from "./render";

/**
The default card, cached for an hour.
*/
export async function defaultCardResponse(request: Request): Promise<Response> {
  return cachedCard(request, CARD_TTL_SECONDS.default, () =>
    renderCard(cardFor(undefined)),
  );
}

/**
 * What the kit's card route found: the card and its version when the kit
 * is public, and the cache tags either way.
 */
export interface KitCardAnswer {
  readonly found?: { readonly card: EntryCardData; readonly version: string };
  readonly tags: readonly string[];
}

/**
 * The response with these headers set over its own.
 */
function withHeaders(
  response: Response,
  headers: Record<string, string>,
): Response {
  const headed = new Response(response.body, response);
  for (const [name, value] of Object.entries(headers)) {
    headed.headers.set(name, value);
  }
  return headed;
}

/**
 * A public kit's card (round 41 #86e, D-151), or the default card for any
 * kit that is not public — the same bytes and headers whatever the
 * reason, kept a minute like the not-public page, so a kit made public
 * shows its own card within the page's TTL.
 *
 * A public kit's card is rendered once a day under its version, which is
 * in its own cache key: the card's URL drops its query string
 * (`cardCacheKey`), so the version goes in the path of the key instead,
 * and an edit renders a new card rather than finding the old one. That
 * cache sits behind the Worker, which checks the kit is still public on
 * every request that reaches it.
 *
 * **The response leaves with the page's minute, not the day.** Workers
 * Caching keeps whatever `Cache-Control` says in front of the Worker, so a
 * day here would serve a retracted kit's card for a day whenever its
 * purge was refused; a minute keeps the TTL the guarantee for the card as
 * for the page (design 161, "Deviations (purge)").
 */
export async function kitCardResponse(
  request: Request,
  entryId: string,
  answer: KitCardAnswer,
): Promise<Response> {
  const { found, tags } = answer;
  if (found === undefined) {
    const fallback = await defaultCardResponse(
      new Request(new URL("/og/default", request.url)),
    );
    return withHeaders(
      fallback,
      publicCacheHeaders(PUBLIC_PAGE_TTL_SECONDS, tags),
    );
  }
  const key = new Request(
    new URL(`/og/k/${entryId}/${found.version}`, request.url),
  );
  const card = await cachedCard(key, CARD_TTL_SECONDS.entry, () =>
    renderCard(cardFor(found.card)),
  );
  return withHeaders(card, publicCacheHeaders(PUBLIC_PAGE_TTL_SECONDS, tags));
}
