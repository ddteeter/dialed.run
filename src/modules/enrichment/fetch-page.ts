import ipaddr from "ipaddr.js";

import { PageFetchError, readCapped } from "./bounds";
import { scrapeThroughProxy } from "./firecrawl";

/**
 * The one outbound fetch enrichment makes, and the only place a product URL
 * reaches the network.
 *
 * Everything here is a bound: https only, no private address space, ten
 * seconds, six megabytes, five redirects.
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
 *   mobile proxy egress, and it is measured: all eight blocked pages came
 *   back 200 through Firecrawl's `/v2/scrape` with `proxy: "auto"`, on the
 *   **basic** proxy, at **1 credit each** — `auto` never escalated. The
 *   enhanced tier is not plan-gated either; an explicit `proxy: "stealth"`
 *   on a free key also returned 200 and also billed 1. So the cheapest paid
 *   plan's 5,000 credits is ~5,000 pages, not the ~1,000 an earlier estimate
 *   assumed at 5 credits each. It is **not** Cloudflare Browser Rendering: that is *headless*
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
 * The first is wired, in `firecrawl.ts`: a direct fetch first, because it
 * is free and three of fourteen shops allow it, and on a refusal the same URL
 * through the proxy. The second is not — it has exactly one measured
 * instance (the SOAR shorts page), which is enough to know the shape and not
 * enough to buy for.
 */

const TIMEOUT_MS = 10_000;
const MAX_REDIRECTS = 5;

/**
 * The statuses a proxy can do something about: the page exists and the
 * server chose not to serve *us*. 403 is the measured one — every blocked
 * shop in the sample answered with it — and the other three are the
 * shapes a bot wall takes elsewhere: a challenge dressed as auth, a rate
 * limit, a "temporarily unavailable" that is available to a browser. A 404
 * is not here on purpose: a page that does not exist does not exist from a
 * residential address either, and paying a credit to learn that twice is
 * the wrong kind of thorough.
 */
const REFUSALS = new Set([401, 403, 429, 503]);

/**
 * A literal address in a range that must never be reachable from a fetch.
 *
 * **ipaddr.js, not arithmetic** (PR #72 review). The hand-rolled version
 * knew seven IPv4 ranges and three IPv6 prefixes, and the review asked
 * whether a library should own this. It should: the library parses every
 * form an address takes — `::ffff:7f00:1` is loopback written in hex, and
 * `2130706433` is loopback written as one number — and classifies every
 * range IANA reserves, where the hand-rolled list stopped at the ones its
 * author remembered. Multicast, broadcast and the 240/4 reserved block were
 * all reachable before, and each is now refused.
 *
 * `process` unwraps a v4-mapped v6 address to the v4 it carries, so one
 * range check covers both. The rule is an allow-list: `unicast` is the only
 * range a public shop can live in, and everything else — including ranges
 * that embed a v4 address, like 6to4 — is refused without needing to be
 * named. Refusing what it cannot classify is what makes a guard a guard.
 */
function isPrivateAddress(host: string): boolean {
  // A hostname, not an address. Every literal form is valid here, and a
  // name with dots in it is not; the parser is the authority on which is
  // which.
  if (!ipaddr.isValid(host)) return false;
  return ipaddr.process(host).range() !== "unicast";
}

/**
 * Hostnames we refuse before asking the network anything.
 *
 * **This cannot be complete, and pretending otherwise would be the bug.** A
 * public name that resolves to 127.0.0.1 (DNS rebinding) is invisible here —
 * Workers cannot resolve a name before fetching it, so there is no address to
 * check, and no library changes that: every SSRF filter on npm hooks Node's
 * socket layer, which a Worker does not have. What this stops is the whole
 * literal-address class and the obvious names; the platform's own refusal to
 * route to internal space is the second layer, and the 10s/6MB bounds are
 * the third.
 */
export function isBlockedHost(hostname: string): boolean {
  const host = hostname.toLowerCase();
  // Bracketed IPv6 first, and this is not a tidy-up: a v6 address contains
  // no dot, so the bare-name rule below would have called every public one
  // private and refused it. Found by asserting a public address is allowed.
  if (host.startsWith("[")) {
    // **Fails closed.** An unbalanced bracket is a host we cannot parse, and
    // a guard that shrugs at input it cannot parse is a guard you feed
    // unparseable input. Refusing it costs nothing — `URL.hostname` never
    // produces one.
    if (!host.endsWith("]")) return true;
    return isPrivateAddress(host.slice(1, -1));
  }
  // An empty host has no dot either, so it needs no clause of its own — and
  // `metadata.google.internal` is caught by `.internal` below, which is why
  // neither is written out. Both were, and both were unreachable.
  if (!host.includes(".")) return true; // "localhost", bare names
  if (host.endsWith(".local") || host.endsWith(".internal")) return true;
  return isPrivateAddress(host);
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

export interface FetchedPage {
  /**
  Where the bytes actually came from, after redirects.
  */
  finalUrl: string;
  html: string;
  /**
   * Which door the page came through. Recorded so the share of pastes that
   * needed the proxy is a number, and a bill that grows has a cause.
   */
  via: "direct" | "proxy";
}

export interface FetchOptions {
  /**
   * The Firecrawl key, read from `env` by the consumer and passed in so this
   * module stays importable without bindings. Absent means no proxy: a
   * refusal is recorded as a failed fetch, exactly as before there was one.
   */
  proxyApiKey?: string | undefined;
}

/**
The next hop of a redirect, resolved against the one that sent us there.
*/
function redirectTarget(response: Response, from: URL): URL {
  const location = response.headers.get("location");
  if (location === null) throw new PageFetchError("Redirect with no target");
  const next = URL.parse(location, from.href);
  if (next === null) throw new PageFetchError("Redirect to an unparseable URL");
  return next;
}

/**
 * A response that is neither a redirect nor ok — through the proxy if the
 * status is one a proxy can answer and there is a key, a failure otherwise.
 *
 * Proxied from the hop that was refused: every hop before it passed
 * `assertFetchable`, and the proxy follows any further redirects on its own
 * network, where a hop into private space reaches nothing of ours.
 */
async function refused(
  response: Response,
  at: URL,
  fetchImpl: typeof fetch,
  options: FetchOptions,
): Promise<FetchedPage> {
  if (REFUSALS.has(response.status) && options.proxyApiKey !== undefined) {
    const proxied = await scrapeThroughProxy(
      at.href,
      options.proxyApiKey,
      fetchImpl,
    );
    return { ...proxied, via: "proxy" };
  }
  throw new PageFetchError(`Page returned ${String(response.status)}`);
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
  options: FetchOptions = {},
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
      current = redirectTarget(response, current);
      continue;
    }
    // `await`, not a bare `return` of the promise: under workerd the inner
    // rejection is reported as unhandled before the outer promise adopts
    // it — twelve of them across the suite, from tests that passed — and
    // the mutation runner cannot stringify an error that crossed the
    // isolate boundary, so it crashed the dry run instead of reporting it.
    if (!response.ok) {
      return await refused(response, current, fetchImpl, options);
    }
    return {
      finalUrl: current.href,
      html: await readCapped(response),
      via: "direct",
    };
  }
  throw new PageFetchError(`More than ${String(MAX_REDIRECTS)} redirects`);
}
