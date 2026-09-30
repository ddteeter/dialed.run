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

/**
What `getGlobalStartContext` does in the browser: answers nothing.
*/
function inTheBrowser(): void {
  // The client half of the isomorphic function returns `void 0`.
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

/**
The four builds the router is made in.
*/
const BROWSER_DEV = { DEV: true, SSR: false };
const SERVER_DEV = { DEV: true, SSR: true };
const SERVER_PROD = { DEV: false, SSR: true };

describe("routerSsr", () => {
  it.each([SERVER_DEV, SERVER_PROD])(
    "reads the nonce server.ts put in the request context (%o)",
    (side) => {
      expect(routerSsr(() => ({ nonce: "abc123==" }), side)).toStrictEqual({
        nonce: "abc123==",
      });
    },
  );

  it.each([SERVER_DEV, SERVER_PROD])(
    "has none, rather than failing a redirect, outside a request context (%o)",
    (side) => {
      expect(routerSsr(outsideARequest, side)).toStrictEqual({});
    },
  );

  it.each([BROWSER_DEV, { DEV: false, SSR: false }])(
    "needs none in the browser, whose context is undefined (%o)",
    (side) => {
      expect(routerSsr(inTheBrowser, side)).toStrictEqual({});
    },
  );

  const noNonce = [
    ["an empty nonce", { nonce: "" }],
    ["a nonce that is not text", { nonce: 42 }],
    ["a context without one", { other: "x" }],
  ] as const;

  it.each(noNonce)(
    "throws in dev when a request's context has %s",
    (_label, context) => {
      expect(() => routerSsr(() => context, SERVER_DEV)).toThrow(
        "The request context has no CSP nonce",
      );
    },
  );

  it.each(noNonce)(
    "degrades to no nonce in production when a request's context has %s",
    (_label, context) => {
      expect(routerSsr(() => context, SERVER_PROD)).toStrictEqual({});
    },
  );
});
