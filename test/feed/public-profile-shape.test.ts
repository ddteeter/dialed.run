import { isNotFound } from "@tanstack/react-router";
import { describe, expect, it } from "vitest";

import { publicProfileSearch } from "../../src/modules/feed/inputs";
import {
  FIRST_KITS,
  moreKits,
  profileOrNotFound,
  publicProfileHead,
  type PublicProfile,
} from "../../src/modules/feed/public-profile-shape";

/**
 * The public profile's shape (round 41 #86d, #86f): what the route and the
 * component decide from it.
 */

const ROW = {
  entryId: "01JABCDEFGHJKMNPQRSTVWXYZ0",
  day: "Sat Oct 18",
  distance: { value: "6.2", unit: "mi" },
};

const PROFILE: PublicProfile = {
  handle: "maya_runs",
  kitCount: 12,
  kits: [ROW, ROW, ROW],
};

describe("FIRST_KITS", () => {
  it("is three rows, as round 41 #86d draws", () => {
    expect(FIRST_KITS).toBe(3);
  });
});

describe("moreKits", () => {
  it("is how many the page does not list yet", () => {
    expect(moreKits(PROFILE)).toBe(9);
    expect(moreKits({ ...PROFILE, kitCount: 3 })).toBe(0);
  });
});

describe("publicProfileHead", () => {
  it("is noindex and the handle for a public profile, with the site's default card", () => {
    expect(publicProfileHead(PROFILE)).toStrictEqual({
      meta: [
        { name: "robots", content: "noindex" },
        { title: "@maya_runs" },
      ],
    });
  });

  it("is noindex alone for a profile that is not public, naming no handle", () => {
    expect(publicProfileHead(undefined)).toStrictEqual({
      meta: [{ name: "robots", content: "noindex" }],
    });
  });
});

describe("profileOrNotFound", () => {
  it("hands a public profile through", () => {
    expect(profileOrNotFound(PROFILE)).toBe(PROFILE);
  });

  it("is the router's 404 for anything else, one answer for every reason", () => {
    let thrown: unknown;
    try {
      profileOrNotFound(undefined);
    } catch (error: unknown) {
      thrown = error;
    }
    expect(isNotFound(thrown)).toBe(true);
    expect(thrown).toBeInstanceOf(Error);
    expect(thrown).toMatchObject({ message: "not a public profile" });
  });
});

describe("publicProfileSearch", () => {
  it("lists every kit for ?all=true, and the first three for anything else", () => {
    expect(publicProfileSearch.parse({ all: true })).toStrictEqual({
      all: true,
    });
    expect(publicProfileSearch.parse({})).toStrictEqual({});
    expect(publicProfileSearch.parse({ all: "yes" })).toStrictEqual({
      all: undefined,
    });
    expect(publicProfileSearch.parse({ all: false })).toStrictEqual({
      all: undefined,
    });
  });
});
