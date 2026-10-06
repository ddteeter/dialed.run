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
      "javascript:alert(1)",
      "/auth/login",
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
  });

  it("judges the path, not the search", () => {
    expect(isAccepted("/feed/search?q=/auth")).toBe(true);
    expect(isAccepted("/feed?next=auth")).toBe(true);
  });
});
