import { describe, expect, it, vi } from "vitest";

import { MAX_BYTES } from "../../src/modules/enrichment/bounds";
import { scrapeThroughProxy } from "../../src/modules/enrichment/firecrawl";

/**
 * The proxy is a network response like any other: parsed, bounded, and
 * failed the same way a direct fetch fails. Every case here is a shape the
 * real API can return — measured against eight scrapes on 2026-09-13 — or a
 * bound the direct path already enforces, held to the same number.
 */

const URL_UNDER_TEST = "https://shop.example.com/products/tee";
const KEY = "fc-test-key";

function envelope(
  rawHtml: string,
  metadata?: Record<string, unknown>,
): string {
  return JSON.stringify({
    success: true,
    data: { rawHtml, metadata: metadata ?? { statusCode: 200 } },
  });
}

function answers(body: string, status = 200) {
  const impl: typeof fetch = () =>
    Promise.resolve(new Response(body, { status }));
  return vi.fn(impl);
}

/**
A fetch that answers the scrape endpoint with one envelope.
*/
function proxyAnswering(rawHtml: string, metadata?: Record<string, unknown>) {
  return answers(envelope(rawHtml, metadata));
}

/**
The request body the module sent, as the JSON it is.
*/
function sentBody(init: RequestInit | undefined): unknown {
  const body = init?.body;
  if (typeof body !== "string") throw new TypeError("body was not a string");
  return JSON.parse(body);
}

describe("scrapeThroughProxy", () => {
  it("posts the URL to the scrape endpoint with the key, asking for raw HTML on auto proxy", async () => {
    const fetchImpl = answers(envelope("<html>tee</html>"));
    await scrapeThroughProxy(URL_UNDER_TEST, KEY, fetchImpl);

    const [endpoint, init] = fetchImpl.mock.calls[0] ?? [];
    expect(endpoint).toBe("https://api.firecrawl.dev/v2/scrape");
    expect(init?.method).toBe("POST");
    expect(init?.signal).toBeInstanceOf(AbortSignal);
    const headers = new Headers(init?.headers);
    expect(headers.get("authorization")).toBe(`Bearer ${KEY}`);
    expect(headers.get("content-type")).toBe("application/json");
    // Exactly, not a subset: `proxy: "auto"` is the cost decision (basic
    // first, enhanced only when basic fails) and `rawHtml` is the only
    // format the ladder can read.
    expect(sentBody(init)).toStrictEqual({
      url: URL_UNDER_TEST,
      formats: ["rawHtml"],
      proxy: "auto",
    });
  });

  it("returns the page and where the proxy finally fetched it from", async () => {
    const fetchImpl = answers(
      envelope("<html>tee</html>", {
        statusCode: 200,
        url: "https://shop.example.com/products/tee-2026",
      }),
    );
    const page = await scrapeThroughProxy(URL_UNDER_TEST, KEY, fetchImpl);
    expect(page).toStrictEqual({
      html: "<html>tee</html>",
      finalUrl: "https://shop.example.com/products/tee-2026",
    });
  });

  it("falls back to the requested URL when the proxy does not say where it ended up", async () => {
    const page = await scrapeThroughProxy(
      URL_UNDER_TEST,
      KEY,
      answers(envelope("<html>tee</html>")),
    );
    expect(page.finalUrl).toBe(URL_UNDER_TEST);
  });

  it("reports the proxy's own status when the API call fails", async () => {
    await expect(
      scrapeThroughProxy(URL_UNDER_TEST, KEY, answers("busy", 502)),
    ).rejects.toThrow(/Proxy returned 502/u);
  });

  it("reports the proxy's error when it says the scrape failed", async () => {
    const body = JSON.stringify({ success: false, error: "Insufficient credits" });
    await expect(
      scrapeThroughProxy(URL_UNDER_TEST, KEY, answers(body)),
    ).rejects.toThrow(/Proxy failed: Insufficient credits/u);
  });

  it("treats a response that is not JSON as a failed fetch, not a crash", async () => {
    await expect(
      scrapeThroughProxy(URL_UNDER_TEST, KEY, answers("<html>gateway</html>")),
    ).rejects.toThrow(/did not match/u);
  });

  it("treats JSON of the wrong shape the same way", async () => {
    const body = JSON.stringify({ success: true, data: { markdown: "# tee" } });
    await expect(
      scrapeThroughProxy(URL_UNDER_TEST, KEY, answers(body)),
    ).rejects.toThrow(/did not match/u);
  });

  it("fails when the page refused the proxy too, naming the status", async () => {
    // The proxy fetched *something* — a 403 challenge page — and reports the
    // page's status beside it. That is a page we did not get, not a page.
    const body = envelope("<html>challenge</html>", { statusCode: 403 });
    await expect(
      scrapeThroughProxy(URL_UNDER_TEST, KEY, answers(body)),
    ).rejects.toThrow(/403 through the proxy/u);
  });

  it("accepts the whole 2xx range and nothing beside it", async () => {
    // The ends of the range, both sides: 200 and 299 are pages, 199 and
    // 300 are not. Four cases because `<` and `<=` differ on exactly these.
    for (const statusCode of [200, 299]) {
      const fetchImpl = proxyAnswering("<html>ok</html>", { statusCode });
      const page = await scrapeThroughProxy(URL_UNDER_TEST, KEY, fetchImpl);
      expect(page.html, String(statusCode)).toBe("<html>ok</html>");
    }
    for (const statusCode of [199, 300]) {
      const fetchImpl = proxyAnswering("<html>no</html>", { statusCode });
      const attempt = scrapeThroughProxy(URL_UNDER_TEST, KEY, fetchImpl);
      await expect(attempt, String(statusCode)).rejects.toThrow(
        /through the proxy/u,
      );
    }
  });

  it("holds the page to the same cap as a direct fetch", async () => {
    // One policy, two doors: a page the direct path refuses at 6 MB is
    // refused here at 6 MB, and one exactly at the cap is allowed by both.
    const exact = "x".repeat(MAX_BYTES);
    const page = await scrapeThroughProxy(
      URL_UNDER_TEST,
      KEY,
      proxyAnswering(exact),
    );
    expect(page.html).toHaveLength(MAX_BYTES);

    const oneOver = proxyAnswering(`${exact}x`);
    await expect(
      scrapeThroughProxy(URL_UNDER_TEST, KEY, oneOver),
    ).rejects.toThrow(/exceeded/u);
  });

  it("reads the envelope under a cap a quarter above the page's, and stops there", async () => {
    // The envelope is the page plus escaping plus metadata — measured at
    // 0.9% to 7.3% over the page — so it must be allowed past 6 MB or a
    // legal page would be refused for its wrapping. But it is still a body
    // from the network and still read under a cap: 7.6 MB of envelope is
    // refused while it streams, before anything tries to parse it.
    // A page of quotes, because JSON escapes each one 2:1: 5.5 MB of
    // page becomes 11 MB of envelope, which is what a pathological page
    // looks like from the envelope's side. The +25% cap must reject that
    // while accepting a legal page whose wrapping merely pushes it past the
    // page cap.
    // Sized so the page is under its cap and its envelope is over it —
    // and, for the second case, so the page is under its cap while the
    // envelope is over *its* cap, which is the only way to show that the
    // envelope has a cap of its own rather than borrowing the page's.
    const tenth = MAX_BYTES / 10;
    const withinCap = `${"x".repeat(9 * tenth)}${'"'.repeat(tenth)}`;
    const roomy = envelope(withinCap);
    expect(withinCap.length).toBeLessThanOrEqual(MAX_BYTES);
    expect(roomy.length).toBeGreaterThan(MAX_BYTES);
    const page = await scrapeThroughProxy(URL_UNDER_TEST, KEY, answers(roomy));
    expect(page.html).toHaveLength(withinCap.length);

    const onlyQuotes = '"'.repeat(7 * tenth);
    const bloated = envelope(onlyQuotes);
    expect(onlyQuotes.length).toBeLessThan(MAX_BYTES);
    expect(bloated.length).toBeGreaterThan(MAX_BYTES * 1.25);
    const tooBig = answers(bloated);
    await expect(
      scrapeThroughProxy(URL_UNDER_TEST, KEY, tooBig),
    ).rejects.toThrow(/exceeded/u);
  });
});
