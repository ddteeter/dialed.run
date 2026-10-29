import { describe, expect, it } from "vitest";

import {
  entryCacheTag,
  handleCacheTag,
  kitCacheTags,
  profileCacheTags,
  runnerCacheTag,
} from "../../src/lib/cache-tags";

/**
 * The open web's cache tags (design 160, D-152): what a page is stored
 * under and what a purge names, from one place.
 */
describe("the cache tags", () => {
  it("name a kit, a runner and a handle's path", () => {
    expect(entryCacheTag("01J00000000000000000000000")).toBe(
      "entry:01J00000000000000000000000",
    );
    expect(runnerCacheTag("u1")).toBe("runner:u1");
    expect(handleCacheTag("maya_runs")).toBe("handle:maya_runs");
  });

  it("purge a kit's own page and its runner's with one call", () => {
    expect(kitCacheTags("u1", "e1")).toStrictEqual(["entry:e1", "runner:u1"]);
  });

  it("purge a profile's runner and the page at its handle's path", () => {
    expect(profileCacheTags("u1", "maya")).toStrictEqual([
      "runner:u1",
      "handle:maya",
    ]);
  });

  it("purge only the runner's when there is no handle", () => {
    // A NULL handle from the database reads the same: the onboarding
    // switch's test reaches it through a row with none.
    expect(profileCacheTags("u1", undefined)).toStrictEqual(["runner:u1"]);
  });
});
