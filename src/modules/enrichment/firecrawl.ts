import { z } from "zod";

import { MAX_BYTES, PageFetchError, readCapped } from "./bounds";
import { parseJson } from "./html";

/**
 * The page through a proxy, when the shop refuses a Worker.
 *
 * **This is the primary path, not an escalation** (see `fetch-page.ts`): 11
 * of 14 sampled retailers refuse Cloudflare egress with a 403 and a
 * challenge page, and every one of them served the same URL to a laptop. What
 * a 403 calls for is residential or mobile egress, which is what Firecrawl's
 * proxies are.
 *
 * Measured 2026-09-13 against the eight blocked pages: all eight came back
 * 200 through `/v2/scrape` with `proxy: "auto"`, every one on the *basic*
 * proxy at one credit each — `auto` never had to escalate. So the fallback is
 * cheap, and `auto` is the right setting: it only spends the enhanced proxy
 * on a page the basic one could not fetch.
 *
 * Unconfigured by default. With no key the consumer records the 403 and
 * moves on (law 5); with one, this runs and the same bounds apply.
 */

const ENDPOINT = "https://api.firecrawl.dev/v2/scrape";

/**
 * Longer than the direct fetch's ten seconds, because a proxied fetch is a
 * fetch someone else makes on our behalf and then relays. The eight
 * measured scrapes took two to six seconds; thirty is headroom, not a
 * budget, and it is still well inside a queue consumer's wall clock.
 */
const PROXY_TIMEOUT_MS = 30_000;

/**
 * The envelope is the page plus JSON escaping plus metadata, so it is read
 * under a cap a little above the page's own. Measured over the eight
 * envelopes: 0.9% to 7.3% over the raw page, so a quarter is generous. The
 * page itself is then held to `MAX_BYTES` exactly, so a page the direct
 * path would refuse is refused here too — one policy, two doors.
 */
const ENVELOPE_LIMIT = MAX_BYTES + MAX_BYTES / 4;

/**
 * The parts of the response we act on, and nothing else. The metadata block
 * carries forty-odd keys copied off the page's meta tags; `statusCode` is
 * the only one a decision turns on. `url` is where the bytes came from after
 * the proxy followed redirects — the field the direct path derives by hand.
 */
const metadataSchema = z.object({
  statusCode: z.number(),
  url: z.string().optional(),
});
const scrapedSchema = z.object({
  success: z.literal(true),
  data: z.object({ rawHtml: z.string(), metadata: metadataSchema }),
});
const failedSchema = z.object({ success: z.literal(false), error: z.string() });
/**
 * A plain union rather than `discriminatedUnion("success", …)`, and the
 * reason is the gate, not the parse: the two are equivalent on every input,
 * but a discriminated union throws at *module load* if a member is
 * malformed, and the mutation runner reads "the test file failed to import"
 * as zero failures — three mutants that crash the module survived that way.
 * A plain union turns the same mutants into wrong answers a test can see.
 */
const scrapeResponseSchema = z.union([scrapedSchema, failedSchema]);

export interface ProxiedPage {
  finalUrl: string;
  html: string;
}

export async function scrapeThroughProxy(
  url: string,
  apiKey: string,
  fetchImpl: typeof fetch,
): Promise<ProxiedPage> {
  const response = await fetchImpl(ENDPOINT, {
    method: "POST",
    signal: AbortSignal.timeout(PROXY_TIMEOUT_MS),
    headers: {
      authorization: `Bearer ${apiKey}`,
      "content-type": "application/json",
    },
    // `rawHtml` and nothing else, though the API offers more — `markdown`,
    // `html` (cleaned), `links`, `summary`, and `json`, which is Firecrawl
    // running its own model over the page against a schema. Deliberately
    // not used (PR #72 review): the snapshot in R2 is the page as served,
    // so `reextract` runs the same ladder over a page whichever door it
    // came through, and a second model behind a second prompt on eleven of
    // fourteen shops would be an extraction path the eval never measured.
    // Markdown would trim the prompt, but only on proxied pages — two
    // prompt shapes for one model is the drift the pinned provider exists
    // to prevent. Raw bytes are the common denominator, and the cheapest.
    body: JSON.stringify({ url, formats: ["rawHtml"], proxy: "auto" }),
  });
  if (!response.ok) {
    throw new PageFetchError(`Proxy returned ${String(response.status)}`);
  }

  const envelope = await readCapped(response, ENVELOPE_LIMIT);
  // Parsed rather than trusted: this is a network response like any other
  // (CLAUDE.md §Trust boundaries), and a malformed one is a failed fetch,
  // not a crash in the consumer.
  const parsed = scrapeResponseSchema.safeParse(parseJson(envelope));
  if (!parsed.success) {
    throw new PageFetchError("Proxy response did not match its contract");
  }
  const result = parsed.data;
  if (!result.success) {
    throw new PageFetchError(`Proxy failed: ${result.error}`);
  }

  const { rawHtml, metadata } = result.data;
  // The proxy fetched the page; the page itself may still have refused.
  if (metadata.statusCode < 200 || metadata.statusCode >= 300) {
    throw new PageFetchError(
      `Page returned ${String(metadata.statusCode)} through the proxy`,
    );
  }
  // UTF-16 units, not bytes, and that is a floor rather than an estimate: a
  // unit is at least one byte, so anything over here is over in bytes too.
  // The envelope cap above already bounds what a multi-byte page can reach.
  if (rawHtml.length > MAX_BYTES) {
    throw new PageFetchError(`Page exceeded ${String(MAX_BYTES)} bytes`);
  }
  return { finalUrl: metadata.url ?? url, html: rawHtml };
}
