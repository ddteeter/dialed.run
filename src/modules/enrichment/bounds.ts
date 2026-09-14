import { UpstreamError } from "../../lib/errors";

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
 * Read at most `limit` bytes, and stop reading when we pass it.
 *
 * A cap applied to an already-buffered body is not a cap — by the time you
 * can measure it you have already held it in a 128 MB isolate. Content-Length
 * is a claim, not a measurement, so it is used only as an early reject.
 */
export async function readCapped(
  response: Response,
  limit = MAX_BYTES,
): Promise<string> {
  // `Number(null)` is 0, so a missing header needs no branch of its own.
  const claimed = Number(response.headers.get("content-length"));
  if (claimed > limit) {
    throw new PageFetchError(`Page declares ${String(claimed)} bytes`);
  }
  const body = response.body;
  if (body === null) throw new PageFetchError("Page had no body");

  const reader = body.getReader();
  const decoder = new TextDecoder();
  let total = 0;
  let html = "";
  try {
    let isDone = false;
    while (!isDone) {
      const chunk = await reader.read();
      isDone = chunk.done;
      if (chunk.value === undefined) continue;
      total += chunk.value.byteLength;
      if (total > limit) {
        throw new PageFetchError(`Page exceeded ${String(limit)} bytes`);
      }
      html += decoder.decode(chunk.value, { stream: true });
    }
  } finally {
    await reader.cancel();
  }
  return html + decoder.decode();
}
