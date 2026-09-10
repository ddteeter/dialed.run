import { isRedirect } from "@tanstack/react-router";
import { describe, expect, it } from "vitest";
import { z } from "zod";

import {
  orBackToFeed,
  redirectTo,
  requireSignedIn,
} from "../../src/modules/feed/redirect";

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

/**
 * `getSession()` answers `null`, so that is what the guard checks and what
 * this has to pass it — `undefined` would sail straight through. Parsed
 * rather than written, because `unicorn/no-null` forbids the literal and
 * substituting `undefined` for it changes the test into one that passes
 * for the wrong reason.
 */
const NO_SESSION = z.null().parse(JSON.parse("null"));

function redirectFrom(work: () => unknown): { to: unknown } {
  try {
    work();
  } catch (error) {
    if (isRedirect(error)) return (error as { options: { to: unknown } }).options;
    throw error;
  }
  throw new Error("expected a redirect");
}

describe("requireSignedIn", () => {
  it("hands the session back when there is one", () => {
    const session = { user: { id: "01USER" } };
    expect(requireSignedIn(session)).toBe(session);
  });

  it("sends a signed-out visitor to log in", () => {
    // `=== null`, which is what `getSession` answers — not a truthiness
    // check, because a session object is never falsy and a truthy check
    // would read as a wider guard than it is.
    expect(
      redirectFrom(() => {
        requireSignedIn(NO_SESSION);
      }).to,
    ).toBe("/auth/login");
  });
});

describe("orBackToFeed", () => {
  it("hands the value back when it is there", () => {
    const entry = { id: "01ENTRY" };
    expect(orBackToFeed(entry)).toBe(entry);
  });

  it("sends a viewer back to the feed when it is not", () => {
    // The same answer for "does not exist" and "you may not see it":
    // telling someone a private entry exists is most of what they wanted
    // to know.
    expect(redirectFrom(() => { orBackToFeed(undefined); }).to).toBe("/feed");
  });
});
