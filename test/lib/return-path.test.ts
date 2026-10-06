import { describe, expect, it } from "vitest";

import {
  DEFAULT_LANDING,
  landingAfterSignIn,
  returnPathOf,
  returnPathSchema,
} from "../../src/lib/return-path";

/**
 * Log-in's way back. `returnPathSchema`'s refusals of other hosts are
 * pinned where log-in reads them (`test/auth/sign-in-search.test.ts`);
 * this pins the two helpers every redirect site and every way in uses,
 * and the loop rule judged on the path a router would match.
 */

describe("returnPathOf", () => {
  it("is the page's path and search — never its origin or its hash", () => {
    expect(
      returnPathOf({
        pathname: "/feed/entry/01ENTRY",
        searchStr: "?from=mail",
      }),
    ).toBe("/feed/entry/01ENTRY?from=mail");
    expect(returnPathOf({ pathname: "/@ravi_k", searchStr: "" })).toBe(
      "/@ravi_k",
    );
  });

  it("is nothing for a page log-in may not return to", () => {
    expect(
      returnPathOf({ pathname: "/auth/login", searchStr: "?redirect=%2Ffeed" }),
    ).toBeUndefined();
    expect(
      returnPathOf({ pathname: "/auth/signup", searchStr: "" }),
    ).toBeUndefined();
  });

  it("is nothing when the location would resolve to another host", () => {
    expect(
      returnPathOf({ pathname: "//evil.example", searchStr: "" }),
    ).toBeUndefined();
  });
});

describe("landingAfterSignIn", () => {
  it("goes where the runner was going", () => {
    expect(landingAfterSignIn("/feed/entry/01ENTRY?from=mail")).toBe(
      "/feed/entry/01ENTRY?from=mail",
    );
  });

  it("goes to the path a router would land on, not the spelling it came in", () => {
    expect(landingAfterSignIn("/feed/./entry/../me?tab=kits")).toBe(
      "/feed/me?tab=kits",
    );
    expect(landingAfterSignIn("/feed?q=a b")).toBe("/feed?q=a%20b");
  });

  it("keeps a way back as long as any real page, and no longer", () => {
    const longest = `/${"a".repeat(2047)}`;
    expect(longest).toHaveLength(2048);
    expect(landingAfterSignIn(longest)).toBe(longest);
    expect(landingAfterSignIn(`${longest}a`)).toBe("/");
  });

  it("falls back to home with nothing carried", () => {
    expect(DEFAULT_LANDING).toBe("/");
    expect(landingAfterSignIn(undefined)).toBe("/");
  });

  it("falls back to home for every hostile way back", () => {
    for (const hostile of [
      "https://evil.example/",
      "//evil.example/",
      String.raw`/\evil.example/`,
      "/\t/evil.example",
      "/%2Fevil.example",
      // On this origin, but resolving to the pathname `//evil.example/x`,
      // which is protocol-relative to anything building a Location.
      "/.//evil.example/x",
      "/..//evil.example",
      "/feed/..//evil.example",
      // No host to resolve to at all: refused, not thrown.
      "//",
      "javascript:alert(1)",
      "/auth/login",
      "/%61uth/login",
      `/${"a".repeat(2048)}`,
      "",
      42,
    ]) {
      expect(landingAfterSignIn(hostile)).toBe("/");
    }
  });
});

function isAccepted(path: string): boolean {
  return returnPathSchema.safeParse(path).success;
}

describe("returnPathSchema's loop rule", () => {
  it("refuses log-in however the path spells it", () => {
    // A router resolves dot segments and matches case-insensitively, so
    // each of these is log-in.
    expect(isAccepted("/./auth/login")).toBe(false);
    expect(isAccepted("/feed/../auth/login")).toBe(false);
    expect(isAccepted("/AUTH/login")).toBe(false);
    expect(isAccepted("/Auth/signup")).toBe(false);
    expect(isAccepted("/auth")).toBe(false);
    // A router decodes an escaped letter before it matches.
    expect(isAccepted("/%61uth/login")).toBe(false);
    expect(isAccepted("/%41%55%54%48/signup")).toBe(false);
  });

  it("refuses the auth segment, not every path that begins with its letters", () => {
    expect(isAccepted("/authors")).toBe(true);
    expect(isAccepted("/%61uthors")).toBe(true);
  });

  it("judges the path, not the search", () => {
    expect(isAccepted("/feed/search?q=/auth")).toBe(true);
    expect(isAccepted("/feed?next=auth")).toBe(true);
  });
});
