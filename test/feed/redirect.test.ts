import { isRedirect } from "@tanstack/react-router";
import { describe, expect, it } from "vitest";

import { redirectTo } from "../../src/modules/feed/redirect";

/**
 * The one-line wrapper three feed routes send signed-out visitors through.
 * Uncovered, which is a small mutant count and a large blast radius: it is
 * the only thing standing between a signed-out visitor and a page that
 * assumes a session.
 */

describe("redirectTo", () => {
  it("throws the redirect rather than returning it", () => {
    // `redirect()` *returns* a Response. A wrapper that forgot to throw
    // would let every guarded loader carry on regardless.
    expect(() => redirectTo({ to: "/auth/login" })).toThrow();
  });

  it("throws something a router recognises as a redirect", () => {
    try {
      redirectTo({ to: "/auth/login" });
    } catch (error) {
      expect(isRedirect(error)).toBe(true);
      expect(error).toMatchObject({ options: { to: "/auth/login" } });
      return;
    }
    throw new Error("expected a redirect");
  });
});
