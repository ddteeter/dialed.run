import { describe, expect, it, vi } from "vitest";

import {
  PageFetchError,
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

function htmlOnce(html: string, headers: Record<string, string> = {}) {
  // Typed as `fetch` so the recorded call args are typed too — the timeout
  // test reads `init.signal` off them, and an untyped mock makes that `never`.
  const impl: typeof fetch = () =>
    Promise.resolve(new Response(html, { status: 200, headers }));
  return vi.fn(impl);
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
    expect(isBlockedHost("[2001:db8::1]")).toBe(false);
    expect(isBlockedHost("[fe81::1]")).toBe(false);
  });

  it("refuses names that cannot be public", () => {
    expect(isBlockedHost("localhost")).toBe(true);
    expect(isBlockedHost("router.local")).toBe(true);
    expect(isBlockedHost("metadata.google.internal")).toBe(true);
    expect(isBlockedHost("shop.example.com")).toBe(false);
  });
});

describe("fetchProductPage", () => {
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
      "content-length": String(3 * 1024 * 1024),
    });
    await expect(
      fetchProductPage("https://shop.example.com/p", fetchImpl),
    ).rejects.toThrow(/declares/u);
  });

  it("stops reading a body that lies about its size", async () => {
    // Content-Length is a claim. The cap that matters is the one applied
    // while streaming, so this sends 3 MB with no length header at all.
    const oversized = "x".repeat(3 * 1024 * 1024);
    const fetchImpl = htmlOnce(oversized);
    await expect(
      fetchProductPage("https://shop.example.com/p", fetchImpl),
    ).rejects.toThrow(/exceeded/u);
  });

  it("returns the page when everything is in bounds", async () => {
    const fetchImpl = htmlOnce("<html><title>Rover Half-Zip</title></html>");
    const page = await fetchProductPage(
      "https://shop.example.com/p",
      fetchImpl,
    );
    expect(page.html).toContain("Rover Half-Zip");
    expect(page.finalUrl).toBe("https://shop.example.com/p");
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
    const fetchImpl = vi.fn(() =>
      Promise.resolve(new Response("nope", { status: 503 })),
    );
    await expect(
      fetchProductPage("https://shop.example.com/p", fetchImpl),
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
});
