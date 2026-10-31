import { describe, expect, it } from "vitest";

import {
  entryCacheTag,
  handleCacheTag,
  runnerCacheTag,
} from "../../src/lib/cache-tags";
import {
  PUBLIC_PAGE_TTL_SECONDS,
  publicCacheHeaders,
  publicPageHeaders,
  publicPageTags,
  isPubliclyStorable,
  withoutCookiesWhenPublic,
} from "../../src/modules/ops/public-cache";
import {
  UNSTORED,
  withSecurityHeaders,
} from "../../src/modules/ops/security-headers";

/**
 * The open web's cache headers (design 163, D-153).
 */

describe("publicPageTags and publicPageHeaders", () => {
  it("tag a public page with its own tag and its runner, a minute at the edge", () => {
    expect(publicPageTags("handle:maya", "u1")).toStrictEqual([
      "handle:maya",
      "runner:u1",
    ]);
    expect(publicPageHeaders("handle:maya", "u1")).toStrictEqual({
      "Cache-Control": "public, max-age=60",
      "Cache-Tag": "handle:maya,runner:u1",
    });
  });

  it("leave out what is not there: no page tag, no runner", () => {
    expect(publicPageTags(undefined, undefined)).toStrictEqual([]);
    expect(publicPageTags("handle:maya", undefined)).toStrictEqual([
      "handle:maya",
    ]);
    expect(publicPageTags(undefined, "u1")).toStrictEqual(["runner:u1"]);
  });
});

describe("publicCacheHeaders", () => {
  it("is public for the TTL, tagged with every tag", () => {
    expect(
      publicCacheHeaders(PUBLIC_PAGE_TTL_SECONDS, [
        entryCacheTag("01J00000000000000000000000"),
        runnerCacheTag("u1"),
        handleCacheTag("maya_runs"),
      ]),
    ).toStrictEqual({
      "Cache-Control": "public, max-age=60",
      "Cache-Tag":
        "entry:01J00000000000000000000000,runner:u1,handle:maya_runs",
    });
  });

  it("names no Cache-Tag when there is nothing to tag", () => {
    expect(publicCacheHeaders(86_400, [])).toStrictEqual({
      "Cache-Control": "public, max-age=86400",
    });
  });

  it("keeps a public page for a minute: the TTL is the guarantee", () => {
    expect(PUBLIC_PAGE_TTL_SECONDS).toBe(60);
  });
});

function withCookie(cacheControl: string | undefined): Response {
  const headers = new Headers({ "Set-Cookie": "d1b=abc; Path=/" });
  if (cacheControl !== undefined) headers.set("Cache-Control", cacheControl);
  return new Response("body", { status: 404, headers });
}

describe("withoutCookiesWhenPublic", () => {
  it("drops the cookie from a response the edge may store", async () => {
    const response = withoutCookiesWhenPublic(withCookie("public, max-age=60"));

    expect(response.headers.has("Set-Cookie")).toBe(false);
    expect(response.headers.get("Cache-Control")).toBe("public, max-age=60");
    expect(response.status).toBe(404);
    expect(await response.text()).toBe("body");
  });

  it.each([
    ["in any case", "Public, max-age=60"],
    ["after spaces", "  public, max-age=60"],
    ["after another directive", "max-age=60, public"],
  ])("reads the directive %s", (_label, cacheControl) => {
    expect(
      withoutCookiesWhenPublic(withCookie(cacheControl)).headers.has(
        "Set-Cookie",
      ),
    ).toBe(false);
  });

  it.each([
    ["no Cache-Control at all", undefined],
    ["a private one", "private, max-age=31536000, immutable"],
    ["one that only mentions public later", "private, publicish"],
    ["a word that starts with public", "publicly, max-age=60"],
    ["one that names public inside another word", "max-age=60, xpublic"],
  ])("leaves %s as it came", (_label, cacheControl) => {
    const original = withCookie(cacheControl);

    expect(isPubliclyStorable(original)).toBe(false);
    expect(withoutCookiesWhenPublic(original)).toBe(original);
  });

  it("calls a public response storable", () => {
    expect(isPubliclyStorable(withCookie("max-age=60, Public"))).toBe(true);
  });
});

describe("every other response is never stored", () => {
  it("gets private, no-store from the security headers", () => {
    // `server.ts` wraps every response in these. Workers Caching stores a
    // 200 with no Cache-Control for two hours (heuristic freshness), so an
    // app page must say no, or one runner's page could be served to
    // another.
    const secured = withSecurityHeaders(new Response("page"), undefined, {
      nonce: "n",
    });

    expect(secured.headers.get("Cache-Control")).toBe(UNSTORED);
    expect(UNSTORED).toBe("private, no-store");
  });

  it.each([
    ["a photo's", "private, max-age=3600"],
    ["a public page's", "public, max-age=60"],
  ])("keeps %s own Cache-Control", (_label, cacheControl) => {
    const secured = withSecurityHeaders(
      new Response("page", { headers: { "Cache-Control": cacheControl } }),
      undefined,
    );

    expect(secured.headers.get("Cache-Control")).toBe(cacheControl);
  });
});

const sources: Record<string, string> = import.meta.glob(
  ["../../src/**/*.{ts,tsx}", "!../../src/routeTree.gen.ts"],
  { query: "?raw", import: "default", eager: true },
);

describe("only the open web's responses are public", () => {
  it("sets public cache headers in the public kit, the public profile and the card routes only", () => {
    const callers = Object.entries(sources)
      .filter(
        ([, source]) =>
          source.includes("publicCacheHeaders(") ||
          source.includes("publicPageHeaders("),
      )
      .map(([path]) => path.replace("../../", ""))
      .toSorted((left, right) => left.localeCompare(right));

    expect(callers).toStrictEqual([
      "src/modules/feed/public-kit.ts",
      "src/modules/feed/public-profile.ts",
      "src/modules/ops/og/respond.ts",
      "src/modules/ops/public-cache.ts",
    ]);
  });
});
