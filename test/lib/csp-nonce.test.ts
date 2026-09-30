import { describe, expect, it } from "vitest";

import { mintNonce, routerSsr } from "../../src/lib/csp-nonce";

/**
The bytes a base64 nonce decodes to.
*/
function decoded(nonce: string): number[] {
  return Array.from(atob(nonce), (char) => char.codePointAt(0) ?? -1);
}

/**
What `getGlobalStartContext` does on the server outside a request.
*/
function outsideARequest(): unknown {
  throw new Error("No Start context found in AsyncLocalStorage.");
}

describe("mintNonce", () => {
  it("is 128 bits of base64", () => {
    const nonce = mintNonce();

    expect(nonce).toMatch(/^[A-Za-z0-9+/]+=*$/);
    expect(decoded(nonce)).toHaveLength(16);
  });

  it("is a different nonce every request", () => {
    const minted = new Set(Array.from({ length: 50 }, () => mintNonce()));

    expect(minted.size).toBe(50);
  });

  it("round-trips every byte, not just the low ones", () => {
    // A nonce built from the wrong code points would still look like
    // base64; what it would not do is spread its bytes across the range.
    const bytes = Array.from({ length: 50 }, () => decoded(mintNonce())).flat();

    expect(bytes.every((byte) => byte >= 0 && byte <= 255)).toBe(true);
    expect(Math.max(...bytes)).toBeGreaterThan(127);
  });
});

describe("routerSsr", () => {
  it("reads the nonce server.ts put in the request context", () => {
    expect(routerSsr(() => ({ nonce: "abc123==" }))).toStrictEqual({
      nonce: "abc123==",
    });
  });

  it("has none, rather than failing the request, outside a request context", () => {
    expect(routerSsr(outsideARequest)).toStrictEqual({});
  });

  it.each([
    // The browser's answer: its scripts were written by the server.
    ["no context, as in the browser", undefined],
    ["an empty nonce", { nonce: "" }],
    ["a nonce that is not text", { nonce: 42 }],
    ["a context without one", { other: "x" }],
  ])("ignores %s", (_label, context) => {
    expect(routerSsr(() => context)).toStrictEqual({});
  });
});
