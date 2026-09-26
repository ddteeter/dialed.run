import { describe, expect, it } from "vitest";

import {
  didGoogleFail,
  googleReturn,
  parseSignInSearch,
} from "../../src/modules/auth/sign-in-search";

/**
 * Au7's arrival, as the log-in page's search params. A bad value is
 * dropped, never an error: an edited URL is still the ordinary page.
 */
/**
Where a log-in would return to, for one redirect value.
*/
function back(redirect: string): string | undefined {
  return parseSignInSearch({ redirect }).redirect;
}

describe("parseSignInSearch", () => {
  it("carries a form and its return path", () => {
    expect(
      parseSignInSearch({ redirect: "/runs/new", carried: "run" }),
    ).toEqual({ redirect: "/runs/new", carried: "run" });
  });

  it("never carries an email in the URL, whatever is sent", () => {
    // Session storage carries it: a URL lands in the Workers log and the
    // browser's history.
    expect(parseSignInSearch({ email: "dana.k@hey.com" })).toStrictEqual({
      redirect: undefined,
      carried: undefined,
      error: undefined,
    });
  });

  it("is plain Au2 with nothing in the URL", () => {
    expect(parseSignInSearch({})).toEqual({});
  });

  it("accepts each form the notice has a noun for, and nothing else", () => {
    for (const carried of ["run", "garment", "settings"]) {
      expect(parseSignInSearch({ carried }).carried).toBe(carried);
    }
    expect(parseSignInSearch({ carried: "closet" }).carried).toBeUndefined();
  });

  it("returns only to a path on this site", () => {
    expect(back("/closet/abc")).toBe("/closet/abc");
    expect(back("/call?from=tab#top")).toBe("/call?from=tab#top");
    // Another host, however it is spelled.
    expect(back("https://evil.example/")).toBeUndefined();
    expect(back("//evil.example/")).toBeUndefined();
    expect(back(String.raw`/\evil.example/`)).toBeUndefined();
    expect(back("closet")).toBeUndefined();
    expect(back("")).toBeUndefined();
    // Never back into the auth pages.
    expect(back("/auth/login")).toBeUndefined();
    expect(back("/authority")).toBeUndefined();
  });

  it("refuses what a URL parser would quietly rewrite into another host", () => {
    // The parser strips the tab, leaving `//evil.example`.
    expect(back("/\t/evil.example")).toBeUndefined();
    expect(back("/\n/evil.example")).toBeUndefined();
    // A slash or backslash spelled as an escape.
    expect(back("/%2Fevil.example")).toBeUndefined();
    expect(back("/%2fevil.example")).toBeUndefined();
    expect(back("/%5Cevil.example")).toBeUndefined();
    expect(back("/%5cevil.example")).toBeUndefined();
    // Every control character — C0, DEL and C1 — not only the ones a parser
    // strips.
    expect(back("/closet\u{0}")).toBeUndefined();
    expect(back("/closet\u{1F}")).toBeUndefined();
    expect(back("/closet\u{7F}")).toBeUndefined();
    // The edges of the range, from the inside out.
    expect(back("/closet\u{20}x")).toBe("/closet x");
    expect(back("/closet\u{7E}")).toBe("/closet~");
    expect(back("/closet\u{9F}")).toBeUndefined();
    expect(back("/closet\u{A0}")).toBe("/closet\u{A0}");
    // An ordinary escape is still a path on this site.
    expect(back("/feed/search?q=a%20b")).toBe("/feed/search?q=a%20b");
  });

  it("keeps the code a failed Google round trip comes back with", () => {
    expect(parseSignInSearch({ error: "invalid_code" }).error).toBe(
      "invalid_code",
    );
    expect(parseSignInSearch({ error: "x".repeat(101) }).error).toBeUndefined();
    expect(parseSignInSearch({ error: 3 }).error).toBeUndefined();
  });
});

describe("didGoogleFail", () => {
  it("is quiet for no code and for the runner's own cancel, and fails otherwise", () => {
    expect(didGoogleFail(undefined)).toBe(false);
    expect(didGoogleFail("access_denied")).toBe(false);
    expect(didGoogleFail("invalid_code")).toBe(true);
    expect(didGoogleFail("")).toBe(true);
  });
});

describe("googleReturn", () => {
  it("sends success home and failure back to the page, when nothing was carried", () => {
    expect(googleReturn("/auth/signup", {})).toEqual({
      callbackURL: "/",
      errorCallbackURL: "/auth/signup",
    });
  });

  it("carries Au7's way back and its notice through the round trip", () => {
    expect(
      googleReturn("/auth/login", { redirect: "/runs/new", carried: "run" }),
    ).toEqual({
      callbackURL: "/runs/new",
      errorCallbackURL: "/auth/login?redirect=%2Fruns%2Fnew&carried=run",
    });
    expect(googleReturn("/auth/login", { carried: "garment" })).toEqual({
      callbackURL: "/",
      errorCallbackURL: "/auth/login?carried=garment",
    });
  });
});
