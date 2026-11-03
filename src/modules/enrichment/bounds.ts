import { UpstreamError } from "../../lib/errors";
import { readCappedText } from "../../lib/read-capped";

/**
 * The bounds every fetched page is held to, whichever path fetched it.
 *
 * Split out of `fetch-page.ts` when the proxy path arrived: both paths must
 * read a body under the same cap and fail with the same error, and the
 * proxy module cannot import them from the module that imports it.
 */

/**
 * **Measured, not guessed — and 2 MB was too small.** The eight sampled
 * product pages run 619 kB to 2,450 kB, and two of them are over 2 MB, so
 * the original cap silently dropped a quarter of the sample. A modern
 * Shopify theme is heavy in a way that has nothing to do with the product:
 * the whole product JSON is rendered into a `data-product` attribute, once
 * per related product.
 *
 * 6 MB clears the largest seen with room over it, and stays far under a
 * Worker's 128 MB: this is a guard against a stream that never ends, not a
 * budget. The reason it has to be a cap at all is in `readCapped` below.
 */
export const MAX_BYTES = 6 * 1024 * 1024;

/**
 * Any bounded-fetch failure. Always caught by the consumer and recorded as
 * `extraction_status='failed'` — never surfaced to the person who pasted the
 * link, because their save already succeeded (law 5).
 */
export class PageFetchError extends UpstreamError {
  constructor(message: string, options?: { cause?: unknown }) {
    super("PageFetchError", message, options);
  }
}

/**
 * Read at most `limit` bytes of a fetched page (`lib/read-capped.ts` says
 * why it has to be a cap), failing as a `PageFetchError`.
 */
export async function readCapped(
  response: Response,
  limit = MAX_BYTES,
): Promise<string> {
  if (response.body === null) throw new PageFetchError("Page had no body");
  // `return await`: under workerd an inner rejection returned bare is
  // reported as unhandled before the outer promise adopts it (see
  // `fetch-page.ts`).
  return await readCappedText(
    response,
    limit,
    (detail) => new PageFetchError(`Page ${detail}`),
  );
}

/**
 * A fetch failure in the words the Desk's Gave up puts on its row
 * (Operator Screens D6: "the last failure translated, one sentence"). The
 * page's own status is the one fact an operator can act on — a 403 is a
 * shop refusing us, which no retry changes — so it is named; everything
 * else is the error itself, which the row keeps as its raw detail.
 *
 * Takes the message rather than the error, because a failure inside the
 * sweep's day of retries is listed only when the product is abandoned
 * (R-119), from the message the product kept.
 */
export function pageFailureReason(message: string): string {
  // The proxy path says the same thing with a suffix ("Page returned 403
  // through the proxy", `firecrawl.ts`): the shop refused the proxy too,
  // which is the refusal an operator most needs named.
  const status = /^Page returned (\d{3})(?: through the proxy)?$/u.exec(
    message,
  )?.[1];
  if (status === undefined) return "The shop's page couldn't be read.";
  const isRefused = status === "401" || status === "403";
  return isRefused
    ? `The shop returned ${status}. It may be blocking us.`
    : `The shop returned ${status}.`;
}
