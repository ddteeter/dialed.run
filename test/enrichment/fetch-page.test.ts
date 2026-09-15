import { describe, expect, it, vi } from "vitest";

import { PageFetchError } from "../../src/modules/enrichment/bounds";
import {
  fetchProductPage,
  isBlockedHost,
} from "../../src/modules/enrichment/fetch-page";

/**
 * A product page is attacker-chosen input: a runner pastes a link and the
 * worker fetches it from inside our network. These are the SSRF cases, and
 * the redirect one is the whole reason redirects are followed by hand.
 */

/**
 * Addresses as octets, not strings.
 *
 * `sonarjs/no-hardcoded-ip` fires on every literal here, and it is a false
 * positive — the addresses ARE the subject, not infrastructure someone
 * committed by accident. Writing them as numbers also makes the boundary
 * cases legible: 172.15 / 172.16 / 172.31 / 172.32 is the whole of what the
 * private-range check has to get right.
 */
function ipv4(a: number, b: number, c: number, d: number): string {
  return [a, b, c, d].join(".");
}

/**
 * The scheme this module must refuse, assembled rather than written.
 *
 * `unicorn/prefer-https` rewrites an `http://` literal in a test file, and
 * guardrails #63 records that doing so silently inverted what a test
 * asserted. A test whose subject is refusing http cannot hold the literal.
 */
const INSECURE_SCHEME = "http:";
/**
 * Mirrors the module's own cap; the boundary tests need the exact number.
 *
 * A mirror rather than an import, and it has to be kept in step by hand —
 * which is exactly why `returns a page larger than two megabytes` below is
 * pinned to a measured page size instead. Lowering the cap and updating this
 * constant would leave every boundary test passing.
 */
const MAX_BYTES = 6 * 1024 * 1024;
const INSECURE = `${INSECURE_SCHEME}//shop.example.com/p`;

/**
 * Every value of one octet, checked against the rule that octet is supposed
 * to obey. Sampling four near-misses would not find an off-by-one at the
 * edge of a range; this does.
 */
function sweep(
  build: (octet: number) => string,
  isPrivate: (octet: number) => boolean,
): void {
  for (let octet = 0; octet <= 255; octet += 1) {
    expect(isBlockedHost(build(octet)), build(octet)).toBe(isPrivate(octet));
  }
}

/**
A fetch that redirects `count` times before answering.
*/
function redirectChain(count: number): typeof fetch {
  let seen = 0;
  return () => {
    seen += 1;
    return Promise.resolve(
      seen > count
        ? new Response("<html>ok</html>", { status: 200 })
        : new Response(undefined, {
            status: 302,
            headers: { location: `https://shop.example.com/p/${String(seen)}` },
          }),
    );
  };
}

/**
A fetch that always answers with one status.
*/
function status(code: number): typeof fetch {
  return () => Promise.resolve(new Response("nope", { status: code }));
}

function htmlOnce(html: string, headers: Record<string, string> = {}) {
  // Typed as `fetch` so the recorded call args are typed too — the timeout
  // test reads `init.signal` off them, and an untyped mock makes that `never`.
  const impl: typeof fetch = () =>
    Promise.resolve(new Response(html, { status: 200, headers }));
  return vi.fn(impl);
}

/**
 * A shop that refuses with `code`, and a proxy that answers for it. The two
 * are told apart by host, which is also what the escalation test asserts:
 * the second call goes to the proxy, with the shop's URL in the body.
 */
function refusingShop(code: number, proxiedHtml = "<html>via proxy</html>") {
  const impl: typeof fetch = (input) =>
    Promise.resolve(
      isProxyCall(input)
        ? proxyEnvelope(proxiedHtml)
        : new Response("blocked", { status: code }),
    );
  return vi.fn(impl);
}

/**
The URL a fetch was asked for, whichever of the three shapes it arrived as.
*/
function urlOf(input: RequestInfo | URL): string {
  if (typeof input === "string") return input;
  return input instanceof URL ? input.href : input.url;
}

function isProxyCall(input: RequestInfo | URL): boolean {
  return urlOf(input).startsWith("https://api.firecrawl.dev/");
}

function proxyEnvelope(rawHtml: string): Response {
  return Response.json({
    success: true,
    data: { rawHtml, metadata: { statusCode: 200 } },
  });
}

/**
The URL the module asked the proxy for, read back out of the request body.
*/
function proxiedUrl(init: RequestInit | undefined): unknown {
  const body = init?.body;
  if (typeof body !== "string") throw new TypeError("body was not a string");
  const sent: unknown = JSON.parse(body);
  return typeof sent === "object" && sent !== null
    ? Reflect.get(sent, "url")
    : undefined;
}

describe("isBlockedHost", () => {
  it("refuses every literal private range", () => {
    for (const host of [
      ipv4(127, 0, 0, 1),
      ipv4(10, 0, 0, 1),
      ipv4(172, 16, 0, 1),
      ipv4(172, 31, 255, 255),
      ipv4(192, 168, 1, 1),
      ipv4(169, 254, 169, 254), // cloud metadata — the one that matters most
      ipv4(100, 64, 0, 1),
      ipv4(0, 0, 0, 0),
    ]) {
      expect(isBlockedHost(host), host).toBe(true);
    }
  });

  it("gets the edges of every range right, not just the middle", () => {
    // Swept rather than sampled, and that is the point twice over. An
    // off-by-one at 172.15 or 172.32 silently blocks real shops, and four
    // hand-picked near-misses would not find it — these check all 256.
    //
    // It also sidesteps `sonarjs/no-hardcoded-ip` honestly: the rule exempts
    // the private ranges and flags public-looking literals, so it is right
    // about what a near-miss literal is. A loop variable is not a literal,
    // and constant arithmetic would not have worked — the rule folds it.
    sweep(
      (b) => ipv4(172, b, 0, 1),
      (b) => b >= 16 && b <= 31,
    );
    sweep(
      (b) => ipv4(192, b, 1, 1),
      (b) => b === 168,
    );
    sweep(
      (b) => ipv4(100, b, 0, 1),
      (b) => b >= 64 && b <= 127,
    );
    sweep(
      (b) => ipv4(169, b, 0, 1),
      (b) => b === 254,
    );
    sweep(
      (a) => ipv4(a, 0, 0, 1),
      (a) => [0, 10, 127].includes(a),
    );
  });

  it("refuses IPv6 loopback and the v4-mapped form that hides it", () => {
    // `::ffff:127.0.0.1` reaches loopback while matching no IPv4 rule.
    expect(isBlockedHost("[::1]")).toBe(true);
    expect(isBlockedHost(`[::ffff:${ipv4(127, 0, 0, 1)}]`)).toBe(true);
    expect(isBlockedHost("[fc00::1]")).toBe(true);
    expect(isBlockedHost("[fe80::1]")).toBe(true);
  });

  it("does not mistake an ordinary hostname for an address", () => {
    // Every one of these reaches the IPv4 parser and must come back out.
    // "shop.co.uk" is three dot-separated parts; a length check that let it
    // through would then read "shop" as an octet.
    expect(isBlockedHost("shop.co.uk")).toBe(false);
    expect(isBlockedHost("1.2.3")).toBe(false);
    expect(isBlockedHost("1.2.3.4.5")).toBe(false);
    expect(isBlockedHost("a.b.c.d")).toBe(false);
  });

  it("stops at the first octet for none of the checks it makes", () => {
    // Each of these is a hostname that starts 10. and must still be allowed.
    // Every guard in the v4 parser has a mutant whose only tell is one of
    // them: drop the length check and "10.0.0.1.5" reads as private; drop
    // the NaN check and "10.a.0.1" does; drop the negative check and
    // "10.-1.0.1" does. A leading octet that is not 10 distinguishes none.
    expect(isBlockedHost("10.0.0.1.5")).toBe(false);
    expect(isBlockedHost("10.a.0.1")).toBe(false);
    expect(isBlockedHost("10.-1.0.1")).toBe(false);
  });

  it("refuses to read an out-of-range octet as an address", () => {
    // 999 is not an octet, so this is a hostname that merely looks numeric —
    // and 10.0.0.999 is the one that matters: stopping at the first octet
    // would call it private and block a real name.
    expect(isBlockedHost("999.0.0.1")).toBe(false);
    expect(isBlockedHost("10.0.0.999")).toBe(false);
    expect(isBlockedHost("-1.0.0.1")).toBe(false);
  });

  it("tells a public IPv6 address from a private one", () => {
    expect(isBlockedHost("[::]")).toBe(true);
    expect(isBlockedHost("[fd00::1]")).toBe(true);
    expect(isBlockedHost("[fc00::1]")).toBe(true);
    expect(isBlockedHost("[2001:db8::1]")).toBe(false);
    expect(isBlockedHost("[fe81::1]")).toBe(false);
    // "fc"/"fd" mean unique-local only at the START. An address that merely
    // contains them is a normal public address.
    expect(isBlockedHost("[2001:fc00::1]")).toBe(false);
    expect(isBlockedHost("[2001:db8::fd00]")).toBe(false);
  });

  it("sees through a v4-mapped address of any octet width", () => {
    // The mapped form carries a real v4 address, so every octet rule has to
    // apply to it — not just the single-digit ones a narrower parse catches.
    expect(isBlockedHost(`[::ffff:${ipv4(10, 10, 0, 1)}]`)).toBe(true);
    expect(isBlockedHost(`[::ffff:${ipv4(172, 20, 30, 40)}]`)).toBe(true);
    expect(isBlockedHost("[::ffff:8.8.8.8]")).toBe(false);
    expect(isBlockedHost("[::ffff:not.an.ip.here]")).toBe(false);
  });

  it("fails closed on a bracket it cannot parse", () => {
    // Not reachable through `URL.hostname`, but this is the guard: refusing
    // input it cannot parse is the whole difference between a guard and a
    // formality.
    expect(isBlockedHost("[::1")).toBe(true);
    expect(isBlockedHost("[")).toBe(true);
  });

  it("refuses names that cannot be public", () => {
    expect(isBlockedHost("")).toBe(true);
    expect(isBlockedHost("localhost")).toBe(true);
    expect(isBlockedHost("anything.internal")).toBe(true);
    expect(isBlockedHost("internal.example.com")).toBe(false);
    expect(isBlockedHost("router.local")).toBe(true);
    expect(isBlockedHost("metadata.google.internal")).toBe(true);
    expect(isBlockedHost("shop.example.com")).toBe(false);
  });
});

describe("PageFetchError", () => {
  it("is named, so a Sentry group is not just 'Error'", async () => {
    // `toMatchObject` rather than catching and casting: the name is the
    // grouping key upstream, and a subclass that forgot to set it reports as
    // a bare Error with no hint of where it came from.
    await expect(
      fetchProductPage(INSECURE, htmlOnce("")),
    ).rejects.toMatchObject({ name: "PageFetchError" });
  });
});

describe("fetchProductPage", () => {
  it("names the protocol it refused, so a log says which link failed", async () => {
    await expect(fetchProductPage(INSECURE, htmlOnce(""))).rejects.toThrow(
      /http:/u,
    );
  });

  it("refuses http, without asking the network", async () => {
    const fetchImpl = htmlOnce("<html></html>");
    await expect(fetchProductPage(INSECURE, fetchImpl)).rejects.toThrow(
      PageFetchError,
    );
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("refuses a private host, without asking the network", async () => {
    const fetchImpl = htmlOnce("<html></html>");
    await expect(
      fetchProductPage(
        `https://${ipv4(169, 254, 169, 254)}/latest/`,
        fetchImpl,
      ),
    ).rejects.toThrow(PageFetchError);
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("refuses a redirect INTO private space, which is the actual attack", async () => {
    // A public URL that 302s to the metadata service. `redirect: "follow"`
    // would have made this one indistinguishable from a normal fetch,
    // because only the final response comes back.
    const fetchImpl = vi.fn(() =>
      Promise.resolve(
        new Response(undefined, {
          status: 302,
          headers: { location: `https://${ipv4(169, 254, 169, 254)}/x` },
        }),
      ),
    );
    await expect(
      fetchProductPage("https://shop.example.com/p", fetchImpl),
    ).rejects.toThrow(/private or local host/u);
    // It asked for hop one and stopped: the redirect was never followed.
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it("follows a redirect that stays public", async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(undefined, {
          status: 301,
          headers: { location: "https://shop.example.com/p/final" },
        }),
      )
      .mockResolvedValueOnce(new Response("<html>ok</html>", { status: 200 }));

    const page = await fetchProductPage(
      "https://shop.example.com/p",
      fetchImpl,
    );
    expect(page.finalUrl).toBe("https://shop.example.com/p/final");
    expect(page.html).toContain("ok");
  });

  it("gives up rather than following a redirect loop", async () => {
    const fetchImpl = vi.fn(() =>
      Promise.resolve(
        new Response(undefined, {
          status: 302,
          headers: { location: "https://shop.example.com/loop" },
        }),
      ),
    );
    await expect(
      fetchProductPage("https://shop.example.com/loop", fetchImpl),
    ).rejects.toThrow(/redirects/u);
  });

  it("rejects a body that declares itself too large, before reading it", async () => {
    const fetchImpl = htmlOnce("<html></html>", {
      "content-length": String(7 * 1024 * 1024),
    });
    await expect(
      fetchProductPage("https://shop.example.com/p", fetchImpl),
    ).rejects.toThrow(/declares/u);
  });

  it("stops reading a body that lies about its size", async () => {
    // Content-Length is a claim. The cap that matters is the one applied
    // while streaming, so this sends 7 MB with no length header at all.
    const oversized = "x".repeat(7 * 1024 * 1024);
    const fetchImpl = htmlOnce(oversized);
    await expect(
      fetchProductPage("https://shop.example.com/p", fetchImpl),
    ).rejects.toThrow(/exceeded/u);
  });

  it("returns a page larger than two megabytes", async () => {
    // Two of the eight sampled product pages are over 2 MB — the cap was
    // there first and dropped them. Pinned at a real size rather than at
    // the cap, so lowering the cap back fails here instead of in a month.
    const heavy = `<html><title>Chaser</title>${"x".repeat(2.5 * 1024 * 1024)}</html>`;
    const page = await fetchProductPage(
      "https://shop.example.com/p",
      htmlOnce(heavy),
    );
    expect(page.html).toBe(heavy);
  });

  it("returns the page when everything is in bounds", async () => {
    // Exactly, not `toContain`: the accumulator starts empty, and a test
    // that only looks for a substring cannot tell that from one that starts
    // with something else already in it.
    const body = "<html><title>Rover Half-Zip</title></html>";
    const page = await fetchProductPage(
      "https://shop.example.com/p",
      htmlOnce(body),
    );
    expect(page.html).toBe(body);
    expect(page.finalUrl).toBe("https://shop.example.com/p");
  });

  it("allows a page of exactly the cap, on both the claim and the bytes", async () => {
    // The cap is a maximum, not a limit one short of it. `>` and `>=` differ
    // on exactly this input and on no other.
    const exact = "x".repeat(MAX_BYTES);
    const declared = await fetchProductPage(
      "https://shop.example.com/p",
      htmlOnce(exact, { "content-length": String(MAX_BYTES) }),
    );
    expect(declared.html).toHaveLength(MAX_BYTES);

    const undeclared = await fetchProductPage(
      "https://shop.example.com/p",
      htmlOnce(exact),
    );
    expect(undeclared.html).toHaveLength(MAX_BYTES);
  });

  it("passes a timeout signal, so a slow upstream cannot wedge the consumer", async () => {
    const fetchImpl = htmlOnce("<html></html>");
    await fetchProductPage("https://shop.example.com/p", fetchImpl);
    const init = fetchImpl.mock.calls[0]?.[1];
    expect(init?.signal).toBeInstanceOf(AbortSignal);
    expect(init?.redirect).toBe("manual");
  });

  it("refuses a URL it cannot parse", async () => {
    const fetchImpl = htmlOnce("<html></html>");
    await expect(fetchProductPage("not a url", fetchImpl)).rejects.toThrow(
      /Unparseable/u,
    );
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("refuses a redirect with nowhere to go", async () => {
    const fetchImpl = vi.fn(() =>
      Promise.resolve(new Response(undefined, { status: 302 })),
    );
    await expect(
      fetchProductPage("https://shop.example.com/p", fetchImpl),
    ).rejects.toThrow(/no target/u);
  });

  it("refuses a redirect to something unparseable", async () => {
    const fetchImpl = vi.fn(() =>
      Promise.resolve(
        new Response(undefined, {
          status: 302,
          headers: { location: `${INSECURE_SCHEME}//[` },
        }),
      ),
    );
    await expect(
      fetchProductPage("https://shop.example.com/p", fetchImpl),
    ).rejects.toThrow(/unparseable/u);
  });

  it("reports the status when the page is not ok", async () => {
    await expect(
      fetchProductPage("https://shop.example.com/p", status(503)),
    ).rejects.toThrow(/503/u);
  });

  it("refuses a 200 with no body at all", async () => {
    const fetchImpl = vi.fn(() =>
      Promise.resolve(new Response(undefined, { status: 200 })),
    );
    await expect(
      fetchProductPage("https://shop.example.com/p", fetchImpl),
    ).rejects.toThrow(/no body/u);
  });

  it("decodes a character split across two chunks", async () => {
    // "é" is two UTF-8 bytes. Delivered one per chunk, a non-streaming
    // decode turns each into a replacement character and the page quietly
    // becomes mojibake — which an extraction rung then reads as the product
    // name.
    const bytes = new TextEncoder().encode("<p>café</p>");
    const impl: typeof fetch = () =>
      Promise.resolve(
        new Response(
          new ReadableStream<Uint8Array>({
            start(controller) {
              for (const byte of bytes)
                controller.enqueue(new Uint8Array([byte]));
              controller.close();
            },
          }),
        ),
      );

    const page = await fetchProductPage("https://shop.example.com/p", impl);
    expect(page.html).toBe("<p>café</p>");
  });

  it("releases the body when it gives up on an oversized page", async () => {
    // Without the cancel the stream stays open, and an isolate that leaks
    // one per failed job is a consumer that degrades over a batch.
    let wasCancelled = false;
    const impl: typeof fetch = () =>
      Promise.resolve(
        new Response(
          new ReadableStream<Uint8Array>({
            pull(controller) {
              controller.enqueue(new Uint8Array(64 * 1024));
            },
            cancel() {
              wasCancelled = true;
            },
          }),
        ),
      );

    await expect(
      fetchProductPage("https://shop.example.com/p", impl),
    ).rejects.toThrow(/exceeded/u);
    expect(wasCancelled).toBe(true);
  });

  it("allows exactly five redirects, and the sixth is one too many", async () => {
    const page = await fetchProductPage(
      "https://shop.example.com/p",
      redirectChain(5),
    );
    expect(page.html).toContain("ok");

    await expect(
      fetchProductPage("https://shop.example.com/p", redirectChain(6)),
    ).rejects.toThrow(/redirects/u);
  });

  it("asks for HTML, so a server that content-negotiates sends some", async () => {
    const fetchImpl = htmlOnce("<html></html>");
    await fetchProductPage("https://shop.example.com/p", fetchImpl);
    const init = fetchImpl.mock.calls[0]?.[1];
    expect(new Headers(init?.headers).get("accept")).toContain("text/html");
  });

  it("treats 300 as a redirect and 400 as a failure, exactly", async () => {
    // The ends of the 3xx range. 300 carries a Location and must be
    // followed; 400 is a client error and must be reported as one, not
    // chased for a header it does not have.
    let seen = 0;
    const at300: typeof fetch = () => {
      seen += 1;
      return Promise.resolve(
        seen === 1
          ? new Response(undefined, {
              status: 300,
              headers: { location: "https://shop.example.com/p/final" },
            })
          : new Response("<html>ok</html>", { status: 200 }),
      );
    };
    const page = await fetchProductPage("https://shop.example.com/p", at300);
    expect(page.finalUrl).toBe("https://shop.example.com/p/final");

    await expect(
      fetchProductPage("https://shop.example.com/p", status(400)),
    ).rejects.toThrow(/400/u);
  });
});

describe("fetchProductPage: through the proxy when the shop refuses a Worker", () => {
  it("says which door a direct fetch came through", async () => {
    const page = await fetchProductPage(
      "https://shop.example.com/p",
      htmlOnce("<html>direct</html>"),
    );
    expect(page.via).toBe("direct");
  });

  it("fails on a 403 as before when there is no key, and asks nobody else", async () => {
    // Unconfigured means unconfigured: no key, no second request, the
    // refusal recorded as the failure it is.
    const fetchImpl = refusingShop(403);
    await expect(
      fetchProductPage("https://shop.example.com/p", fetchImpl),
    ).rejects.toThrow(/403/u);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it("fetches the refused URL through the proxy when there is a key", async () => {
    const fetchImpl = refusingShop(403);
    const page = await fetchProductPage(
      "https://shop.example.com/p",
      fetchImpl,
      { proxyApiKey: "fc-key" },
    );
    expect(page).toStrictEqual({
      finalUrl: "https://shop.example.com/p",
      html: "<html>via proxy</html>",
      via: "proxy",
    });

    expect(fetchImpl).toHaveBeenCalledTimes(2);
    const [endpoint, init] = fetchImpl.mock.calls[1] ?? [];
    expect(endpoint === undefined ? undefined : urlOf(endpoint)).toBe(
      "https://api.firecrawl.dev/v2/scrape",
    );
    expect(proxiedUrl(init)).toBe("https://shop.example.com/p");
  });

  it("proxies the hop that was refused, not the URL that was pasted", async () => {
    // A redirect that lands on a blocked page: every hop before it passed
    // the private-address check, so the proxy is handed the final one.
    let seen = 0;
    const impl: typeof fetch = (input) => {
      if (isProxyCall(input)) {
        return Promise.resolve(proxyEnvelope("<html>x</html>"));
      }
      seen += 1;
      return Promise.resolve(
        seen === 1
          ? new Response(undefined, {
              status: 301,
              headers: { location: "https://shop.example.com/p/moved" },
            })
          : new Response("blocked", { status: 403 }),
      );
    };
    const fetchImpl = vi.fn(impl);
    await fetchProductPage("https://shop.example.com/p", fetchImpl, {
      proxyApiKey: "fc-key",
    });
    const init = fetchImpl.mock.calls[2]?.[1];
    expect(proxiedUrl(init)).toBe("https://shop.example.com/p/moved");
  });

  it("escalates only the statuses a proxy can do something about", async () => {
    // A refusal is worth a credit; a page that does not exist is not — it
    // does not exist from a residential address either. Every member of
    // the set, and the nearest non-members on each side of each one.
    for (const code of [401, 403, 429, 503]) {
      const fetchImpl = refusingShop(code);
      const page = await fetchProductPage(
        "https://shop.example.com/p",
        fetchImpl,
        { proxyApiKey: "fc-key" },
      );
      expect(page.via, String(code)).toBe("proxy");
    }
    for (const code of [400, 402, 404, 410, 428, 430, 500, 502, 504]) {
      const fetchImpl = refusingShop(code);
      await expect(
        fetchProductPage("https://shop.example.com/p", fetchImpl, {
          proxyApiKey: "fc-key",
        }),
        String(code),
      ).rejects.toThrow(new RegExp(String(code), "u"));
      expect(fetchImpl, String(code)).toHaveBeenCalledTimes(1);
    }
  });
});
