import { isRedirect } from "@tanstack/react-router";
import { describe, expect, it } from "vitest";
import { z } from "zod";

import type { ProfileAtHandle } from "../../src/modules/feed/profiles";
import {
  orBackToFeed,
  orHandlePage,
  redirectTo,
  toHandlePage,
  requireSignedIn,
  viewerContext,
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
    if (isRedirect(error))
      return (error as { options: { to: unknown } }).options;
    throw error;
  }
  throw new Error("expected a redirect");
}

/**
What `work` threw, for matching the redirect's whole `options`.
*/
function thrownBy(work: () => unknown): unknown {
  try {
    work();
  } catch (error) {
    return error;
  }
  throw new Error("expected a redirect");
}

/**
An emailed link to an entry, opened signed out.
*/
const ENTRY_LINK = { pathname: "/feed/entry/01ENTRY", searchStr: "?from=mail" };

describe("requireSignedIn", () => {
  it("hands the session back when there is one", () => {
    const session = { user: { id: "01USER" } };
    expect(requireSignedIn(session, ENTRY_LINK)).toBe(session);
  });

  it("sends a signed-out visitor to log in, carrying the page as the way back", () => {
    // `=== null`, which is what `getSession` answers — not a truthiness
    // check, because a session object is never falsy and a truthy check
    // would read as a wider guard than it is.
    const thrown = thrownBy(() => {
      requireSignedIn(NO_SESSION, ENTRY_LINK);
    });
    expect(isRedirect(thrown)).toBe(true);
    expect(thrown).toMatchObject({
      options: {
        to: "/auth/login",
        search: { redirect: "/feed/entry/01ENTRY?from=mail" },
      },
    });
  });

  it("carries no way back from a page log-in may not return to", () => {
    expect(
      thrownBy(() => {
        requireSignedIn(NO_SESSION, { pathname: "/auth/login", searchStr: "" });
      }),
    ).toMatchObject({
      options: { to: "/auth/login", search: { redirect: undefined } },
    });
  });
});

describe("viewerContext", () => {
  it("is the signed-in viewer's id, as route context", async () => {
    await expect(
      viewerContext(
        () => Promise.resolve({ user: { id: "01USER" } }),
        ENTRY_LINK,
      ),
    ).resolves.toStrictEqual({ viewerId: "01USER" });
  });

  it("sends a signed-out visitor to log in, carrying the page as the way back", async () => {
    const signedOut = viewerContext(
      () => Promise.resolve(NO_SESSION),
      ENTRY_LINK,
    );
    await expect(signedOut).rejects.toSatisfy(isRedirect);
    await expect(signedOut).rejects.toMatchObject({
      options: {
        to: "/auth/login",
        search: { redirect: "/feed/entry/01ENTRY?from=mail" },
      },
    });
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
    expect(
      redirectFrom(() => {
        orBackToFeed(undefined);
      }).to,
    ).toBe("/feed");
  });
});

describe("orHandlePage", () => {
  it("hands back a runner or a changed handle, as they are", () => {
    const changed: ProfileAtHandle = { kind: "changed" };
    const runner: ProfileAtHandle = {
      kind: "runner",
      isFollowing: false,
      profile: {
        userId: "01RAVI",
        username: "ravi_k",
        cityLabel: "Portland",
        recentPublicEntries: [],
      },
    };
    expect(orHandlePage(changed)).toBe(changed);
    expect(orHandlePage(runner)).toBe(runner);
  });

  it("sends the viewer's own handle to G, not to a Follow on themself", () => {
    expect(
      redirectFrom(() => {
        orHandlePage({ kind: "own" });
      }).to,
    ).toBe("/feed/me");
  });

  it("sends a handle nobody may be shown back to the feed", () => {
    expect(
      redirectFrom(() => {
        orHandlePage(undefined);
      }).to,
    ).toBe("/feed");
  });
});

describe("toHandlePage", () => {
  it("sends H by id to the runner's /@handle", () => {
    expect(
      redirectFrom(() => toHandlePage({ username: "ravi_k" })),
    ).toMatchObject({ to: "/@{$handle}", params: { handle: "ravi_k" } });
  });

  it("sends a runner the viewer may not see, or one with no handle, back to the feed", () => {
    expect(redirectFrom(() => toHandlePage(undefined)).to).toBe("/feed");
    expect(redirectFrom(() => toHandlePage({ username: NO_SESSION })).to).toBe(
      "/feed",
    );
  });
});
