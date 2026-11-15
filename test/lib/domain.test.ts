import { describe, expect, it } from "vitest";

import {
  domainOf,
  isOwnHost,
  linkDomainOf,
  siteOf,
  withoutRootDot,
} from "../../src/lib/domain";

/**
 * The same function answers two questions — is this domain denied, and
 * what do we show a runner beside the link — so a disagreement between
 * them would mean a denied domain rendering as allowed.
 */

/**
 * Assembled rather than written as a literal: `unicorn/prefer-https`
 * rejects the literal, and a non-https link is precisely what these
 * assert gets refused.
 */
const INSECURE = ["http", "://example.com"].join("");

describe("reading a domain", () => {
  it("takes the host out of an https URL", () => {
    expect(domainOf("https://janji.com/products/tee")).toBe("janji.com");
  });

  it("lowercases it, so one denylist entry catches both spellings", () => {
    expect(domainOf("https://JANJI.com/x")).toBe("janji.com");
  });

  it("strips a leading www., because a runner cannot tell them apart", () => {
    // An operator adding `example.com` means both; the rendered domain
    // looks identical either way.
    expect(domainOf("https://www.example.com/x")).toBe("example.com");
  });

  it("keeps other subdomains distinct, because those genuinely differ", () => {
    expect(domainOf("https://shop.example.com/x")).toBe("shop.example.com");
  });

  it("does not strip a host that merely starts with the letters www", () => {
    // `wwwtf.com` is not `tf.com`. Only the `www.` label comes off.
    expect(domainOf("https://wwwtf.com/x")).toBe("wwwtf.com");
  });
});

describe("what is not a domain", () => {
  it("refuses a non-https URL", () => {
    // 101 already rejects these at save, so reaching here means a stored
    // oddity — which should render as "no domain", not take down a page.
    expect(domainOf(INSECURE)).toBeUndefined();
    expect(domainOf("javascript:alert(1)")).toBeUndefined();
  });

  it("refuses something that is not a URL at all", () => {
    expect(domainOf("not a url")).toBeUndefined();
    expect(domainOf("")).toBeUndefined();
  });
});

describe("a link that is not there", () => {
  it("has no domain, the same as a link that will not parse", () => {
    // `productUrl` is optional on every garment, so this is the ordinary
    // case rather than an edge one — and answering it here is what keeps
    // the callers from each carrying a guard nothing can reach.
    const missing = undefined;
    expect(domainOf(missing)).toBeUndefined();
  });
});

describe("the app's own host (SA-L14)", () => {
  it.each([
    "dialed.run",
    "DIALED.run",
    "app.dialed.run",
    "photos.dialed.run",
    "dialed.run.",
    "app.dialed.run..",
  ])("is %s", (host) => {
    expect(isOwnHost(host)).toBe(true);
  });

  it.each([
    "notdialed.run",
    "dialed.running.com",
    "dialed.run.evil.example",
    "run",
  ])("is not %s", (host) => {
    expect(isOwnHost(host)).toBe(false);
  });

  it("shows a shop's domain and none for the app's own pages", () => {
    expect(linkDomainOf("https://www.janji.com/rover")).toBe("janji.com");
    expect(
      linkDomainOf("https://www.dialed.run/onboarding/done"),
    ).toBeUndefined();
    expect(linkDomainOf("https://dialed.run./onboarding/done")).toBeUndefined();
    expect(linkDomainOf(undefined)).toBeUndefined();
  });
});

describe("the DNS root's trailing dot (SA-L04)", () => {
  it("reads a host with its root dot as the same site", () => {
    expect(domainOf("https://Spam.Example./x")).toBe("spam.example");
    expect(domainOf("https://www.spam.example./x")).toBe("spam.example");
    expect(siteOf("WWW.Spam.Example.")).toBe("spam.example");
  });

  it("takes one dot only, and nothing from a host without one", () => {
    expect(withoutRootDot("spam.example..")).toBe("spam.example.");
    expect(withoutRootDot("spam.example")).toBe("spam.example");
    expect(withoutRootDot("")).toBe("");
  });
});
