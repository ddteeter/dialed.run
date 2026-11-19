import { describe, expect, it } from "vitest";

import { domainOf } from "../../src/lib/domain";

/**
 * Two things the runtime does that code in `src/lib` is written around
 * (design 239). Each was taken from the standard when the code was
 * written; these ask workerd itself, beside what the code does about it.
 */
describe("the URL parser and a host's root dot", () => {
  it("keeps the trailing dot in hostname, lower-cased", () => {
    expect(new URL("https://Spam.Example./x").hostname).toBe("spam.example.");
  });

  it("is why lib/domain drops the dot before a host is compared (SA-L04)", () => {
    expect(domainOf("https://Spam.Example./x")).toBe("spam.example");
  });
});

describe("JSON.parse and a __proto__ key", () => {
  const parsed: unknown = JSON.parse('{"__proto__":{"on":1},"kept":1}');

  it("makes it an own key, and leaves the value's prototype alone", () => {
    expect(Object.hasOwn(new Object(parsed), "__proto__")).toBe(true);
    expect(Object.getPrototypeOf(parsed)).toBe(Object.prototype);
  });

  it("is written through the inherited setter by Object.assign", () => {
    // Why what arrives is parsed through a schema before an Error is made
    // of it (SA-L13, `test/lib/auth-signal.test.ts`): a copy by assignment
    // would hand the new object the sender's prototype.
    const copy: object = Object.assign(new Error("x"), parsed);
    expect(copy).not.toBeInstanceOf(Error);
    expect(copy).toHaveProperty("on", 1);
  });
});
