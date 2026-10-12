/**
 * The card routes' bodies, here rather than in the route files so a test
 * can reach them (a route is glue and cannot be imported).
 */
import { cardFor } from "./cards";
import { CARD_TTL_SECONDS, cachedCard, renderCard } from "./render";

/**
The default card, cached for an hour.
*/
export async function defaultCardResponse(request: Request): Promise<Response> {
  return cachedCard(request, CARD_TTL_SECONDS.default, () =>
    renderCard(cardFor(undefined)),
  );
}
