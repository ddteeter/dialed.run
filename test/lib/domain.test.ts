import { describe, expect, it } from "vitest";

import { domainOf } from "../../src/lib/domain";

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
