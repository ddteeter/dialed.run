import { describe, expect, it } from "vitest";

import { parseSignInSearch } from "../../src/modules/auth/sign-in-search";

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
  it("carries a form, its return path and the email to prefill", () => {
    expect(
      parseSignInSearch({
        redirect: "/runs/new",
        carried: "run",
        email: "dana.k@hey.com",
      }),
    ).toEqual({ redirect: "/runs/new", carried: "run", email: "dana.k@hey.com" });
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
    // Another host, however it is spelled.
    expect(back("https://evil.example/")).toBeUndefined();
    expect(back("//evil.example/")).toBeUndefined();
    expect(back(String.raw`/\evil.example/`)).toBeUndefined();
    expect(back("closet")).toBeUndefined();
    // Never back into the auth pages.
    expect(back("/auth/login")).toBeUndefined();
    expect(back("/authority")).toBeUndefined();
  });

  it("drops an email that is not one", () => {
    expect(parseSignInSearch({ email: "dana" }).email).toBeUndefined();
  });
});
