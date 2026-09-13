/**
 * The one outbound fetch enrichment makes, and the only place a product URL
 * reaches the network.
 *
 * Everything here is a bound: https only, no private address space, ten
 * seconds, two megabytes, five redirects.
 *
 * **The SSRF guard is hygiene, not the real risk, and overselling it would be
 * the mistake.** There is no VPC, no origin server, and no instance metadata
 * service on Workers; D1, R2 and Queues are reached through bindings rather
 * than the network. A hostile URL has very little to reach. The guard stays
 * because "we fetch arbitrary user URLs and never checked" is a bad sentence
 * to write later, and because it is nearly free.
 *
 * **The real risk is that the fetch simply fails, and that is permanent.**
 * Extraction improves retroactively — `reextract` re-runs the ladder over a
 * stored snapshot — but a page never retrieved has no snapshot, so nothing
 * later can heal it. Fetch reliability is therefore worth more care than
 * extraction accuracy.
 *
 * **When this starts failing, diagnose before buying anything.** The two
 * failure modes look similar and want opposite tools:
 *
 * - **403 or a challenge page** — bot blocked. The answer is residential or
 *   mobile proxy egress (Firecrawl stealth, ~4 credits, roughly $3.30 per
 *   1,000). It is **not** Cloudflare Browser Rendering: that is *headless*
 *   Chromium leaving from Cloudflare datacenter ranges, and a large share of
 *   retailers sit behind Cloudflare, which identifies its own infrastructure
 *   better than it identifies a random home connection. Same network is their
 *   detection advantage, not our trust — a Worker subrequest gets scored as a
 *   bot like anything else, and every documented remedy (IP allowlist, WAF
 *   rule) requires control of the site being fetched, which we do not have.
 * - **200 with the content missing** — client-rendered. *Now* Browser
 *   Rendering is right, and it is on-platform and effectively free at our
 *   volume: 10 browser hours/month included, which is thousands of pages.
 *
 * Neither is wired, deliberately. A fallback bought before the failure is
 * measured is a guess with a bill attached.
 */

const TIMEOUT_MS = 10_000;
const MAX_BYTES = 2 * 1024 * 1024;
const MAX_REDIRECTS = 5;

/**
 * Any bounded-fetch failure. Always caught by the consumer and recorded as
 * `extraction_status='failed'` — never surfaced to the person who pasted the
 * link, because their save already succeeded (law 5).
 */
export class PageFetchError extends Error {
  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = "PageFetchError";
  }
}

/**
Literal IPv4 in the ranges that must never be reachable from a fetch.
*/
function isPrivateIpv4(host: string): boolean {
  const parts = host.split(".");
  if (parts.length !== 4) return false;
  const octets = parts.map(Number);
  if (octets.some((n) => !Number.isSafeInteger(n) || n < 0 || n > 255))
    return false;
  const [a = 0, b = 0] = octets;
  return (
    a === 0 || // "this network"
    a === 10 || // private
    a === 127 || // loopback
    (a === 169 && b === 254) || // link-local, and AWS/GCP metadata
    (a === 172 && b >= 16 && b <= 31) || // private
    (a === 192 && b === 168) || // private
    (a === 100 && b >= 64 && b <= 127) // CGNAT
  );
}

/**
 * IPv6 loopback, unique-local and link-local, plus the v4-mapped forms —
 * `::ffff:127.0.0.1` reaches loopback while matching no v4 rule above.
 */
const MAPPED_V4 = "::ffff:";

function isPrivateIpv6(host: string): boolean {
  // Prefixes rather than anchored regexes. Both say the same thing, but an
  // anchor's only distinguishing input is a malformed host, so the rule is
  // written as the string test it actually is. Brackets are stripped by the
  // caller, which is also where a malformed pair is refused.
  const inner = host.toLowerCase();
  if (inner === "::1" || inner === "::") return true;
  // `::ffff:127.0.0.1` reaches loopback while matching no v4 rule, and the
  // v4 parser already rejects anything that is not four real octets.
  if (inner.startsWith(MAPPED_V4)) {
    return isPrivateIpv4(inner.slice(MAPPED_V4.length));
  }
  return (
    inner.startsWith("fc") ||
    inner.startsWith("fd") ||
    inner.startsWith("fe80:")
  );
}

/**
 * Hostnames we refuse before asking the network anything.
 *
 * **This cannot be complete, and pretending otherwise would be the bug.** A
 * public name that resolves to 127.0.0.1 (DNS rebinding) is invisible here —
 * Workers cannot resolve a name before fetching it, so there is no address to
 * check. What this stops is the whole literal-address class and the obvious
 * names; the platform's own refusal to route to internal space is the second
 * layer, and the 10s/2MB bounds are the third.
 */
export function isBlockedHost(hostname: string): boolean {
  const host = hostname.toLowerCase();
  // Bracketed IPv6 first, and this is not a tidy-up: a v6 address contains
  // no dot, so the bare-name rule below would have called every public one
  // private and refused it. Found by asserting 2001:db8:: is allowed.
  if (host.startsWith("[")) {
    // **Fails closed.** An unbalanced bracket is a host we cannot parse, and
    // a guard that shrugs at input it cannot parse is a guard you feed
    // unparseable input. Refusing it costs nothing — `URL.hostname` never
    // produces one.
    if (!host.endsWith("]")) return true;
    return isPrivateIpv6(host.slice(1, -1));
  }
  // An empty host has no dot either, so it needs no clause of its own — and
  // `metadata.google.internal` is caught by `.internal` below, which is why
  // neither is written out. Both were, and both were unreachable.
  if (!host.includes(".")) return true; // "localhost", bare names
  if (host.endsWith(".local") || host.endsWith(".internal")) return true;
  return isPrivateIpv4(host) || isPrivateIpv6(host);
}

/**
https, and a host we are willing to ask for.
*/
function assertFetchable(url: URL): void {
  if (url.protocol !== "https:") {
    throw new PageFetchError(`Refusing a non-https URL: ${url.protocol}`);
  }
  if (isBlockedHost(url.hostname)) {
    throw new PageFetchError(
      `Refusing a private or local host: ${url.hostname}`,
    );
  }
}

/**
 * Read at most `MAX_BYTES`, and stop reading when we pass it.
 *
 * A cap applied to an already-buffered body is not a cap — by the time you
 * can measure it you have already held it in a 128 MB isolate. Content-Length
 * is a claim, not a measurement, so it is used only as an early reject.
 */
async function readCapped(response: Response): Promise<string> {
  // `Number(null)` is 0, so a missing header needs no branch of its own.
  const claimed = Number(response.headers.get("content-length"));
  if (claimed > MAX_BYTES) {
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
      if (total > MAX_BYTES) {
        throw new PageFetchError(`Page exceeded ${String(MAX_BYTES)} bytes`);
      }
      html += decoder.decode(chunk.value, { stream: true });
    }
  } finally {
    await reader.cancel();
  }
  return html + decoder.decode();
}

export interface FetchedPage {
  /**
  Where the bytes actually came from, after redirects.
  */
  finalUrl: string;
  html: string;
}

/**
 * Fetch a product page under every bound above.
 *
 * **Redirects are followed by hand**, because `redirect: "follow"` would let
 * hop two land somewhere hop one was checked to prevent — a public URL that
 * 302s to `http://169.254.169.254/` is the whole attack, and the platform
 * hands back only the final response. Each hop is re-validated.
 */
export async function fetchProductPage(
  rawUrl: string,
  fetchImpl: typeof fetch = fetch,
): Promise<FetchedPage> {
  const parsed = URL.parse(rawUrl);
  if (parsed === null) throw new PageFetchError("Unparseable URL");

  let current = parsed;
  for (let hop = 0; hop <= MAX_REDIRECTS; hop += 1) {
    assertFetchable(current);

    const response = await fetchImpl(current.href, {
      redirect: "manual",
      signal: AbortSignal.timeout(TIMEOUT_MS),
      headers: { accept: "text/html,application/xhtml+xml" },
    });

    if (response.status >= 300 && response.status < 400) {
      const location = response.headers.get("location");
      if (location === null)
        throw new PageFetchError("Redirect with no target");
      const next = URL.parse(location, current.href);
      if (next === null)
        throw new PageFetchError("Redirect to an unparseable URL");
      current = next;
      continue;
    }

    if (!response.ok) {
      throw new PageFetchError(`Page returned ${String(response.status)}`);
    }
    return { finalUrl: current.href, html: await readCapped(response) };
  }
  throw new PageFetchError(`More than ${String(MAX_REDIRECTS)} redirects`);
}
