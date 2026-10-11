import { describe, expect, it } from "vitest";

import { ipKey, requesterKey } from "../../src/modules/safety/requester-key";

/**
 * Design 137: two addresses that reach one inbox are one requester.
 */
describe("requesterKey", () => {
  it("reads Gmail's dots, tags and googlemail as one inbox", () => {
    for (const address of [
      "me@gmail.com",
      "M.E@gmail.com",
      "me+1@gmail.com",
      "m.e+takedown@googlemail.com",
    ]) {
      expect(requesterKey(address)).toBe("me@gmail.com");
    }
  });

  it("drops the tag Outlook, iCloud and Yahoo use", () => {
    expect(requesterKey("me+x@outlook.com")).toBe("me@outlook.com");
    expect(requesterKey("me+x@icloud.com")).toBe("me@icloud.com");
    expect(requesterKey("me-x@yahoo.com")).toBe("me@yahoo.com");
  });

  it("drops a +tag on any other domain, and keeps its dots", () => {
    expect(requesterKey("first.last+abc@example.org")).toBe(
      "first.last@example.org",
    );
  });

  it("lowercases and trims, and leaves a plain address alone", () => {
    expect(requesterKey("  Sam@Example.com ")).toBe("sam@example.com");
    expect(requesterKey("sam@example.com")).toBe("sam@example.com");
  });

  it("keys an address validator will not read by its lowercase", () => {
    // `normalizeEmail` answers false for what is not an address; the form
    // never sends one, and the key still has to be something.
    expect(requesterKey("Not An Address")).toBe("not an address");
  });

  it("keeps an address Gmail's rules would empty, minus its tag", () => {
    // validator answers false for "+x@gmail.com": nothing before the @.
    expect(requesterKey("+x@gmail.com")).toBe("@gmail.com");
    expect(requesterKey("A.B+x@Example.com")).toBe("a.b@example.com");
  });
});

describe("ipKey", () => {
  it("is a keyed hex HMAC: the same IP and secret give the same key", async () => {
    const one = await ipKey("203.0.113.9", "secret");
    expect(one).toMatch(/^[0-9a-f]{64}$/u);
    expect(await ipKey("203.0.113.9", "secret")).toBe(one);
    // RFC 4231 test case 2: HMAC-SHA-256, not a bare hash.
    expect(await ipKey("what do ya want for nothing?", "Jefe")).toBe(
      "5bdcc146bf60754e6a042426089575c75a003f089d2739839dec58b964ec3843",
    );
  });

  it("differs by IP and by secret", async () => {
    const base = await ipKey("203.0.113.9", "secret");
    expect(await ipKey("203.0.113.10", "secret")).not.toBe(base);
    expect(await ipKey("203.0.113.9", "other")).not.toBe(base);
  });

  it("is absent without the address or the secret", async () => {
    expect(await ipKey(undefined, "secret")).toBeUndefined();
    expect(await ipKey("203.0.113.9", undefined)).toBeUndefined();
    expect(await ipKey("203.0.113.9", "")).toBeUndefined();
  });
});
