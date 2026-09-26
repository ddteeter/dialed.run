/**
 * The card routes' bodies, here rather than in the route files so a test
 * can reach them (a route is glue and cannot be imported).
 */
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
 * A shared entry's card, or the default for anything not shareable. For
 * task 129's entry route (FEED-14): it hands this the entry's public read,
 * which is `undefined` for a private, deleted, banned or unverified entry.
 */
export async function entryCardResponse(
  request: Request,
  entry: EntryCardData | undefined,
): Promise<Response> {
  return cachedCard(request, CARD_TTL_SECONDS.entry, () =>
    renderCard(cardFor(entry)),
  );
}
