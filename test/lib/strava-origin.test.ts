import { describe, expect, it } from "vitest";

import {
  stravaConnectSearch,
  stravaOriginSchema,
  tryAgainSearch,
} from "../../src/lib/strava-origin";

/**
 * Where a Strava trip started, and the way back to it (round 39 #66,
 * design 172).
 */
describe("stravaOriginSchema", () => {
  it("names P3 and nothing else", () => {
    expect(stravaOriginSchema.options).toEqual(["onboarding"]);
  });
});

describe("stravaConnectSearch", () => {
  it("keeps an origin", () => {
    expect(stravaConnectSearch.parse({ from: "onboarding" })).toEqual({
      from: "onboarding",
    });
  });

  it("drops what is not one, rather than refusing the link", () => {
    expect(stravaConnectSearch.parse({ from: "settings" })).toEqual({
      from: undefined,
    });
    expect(stravaConnectSearch.parse({})).toEqual({});
  });
});

describe("tryAgainSearch", () => {
  it("keeps again=true", () => {
    expect(tryAgainSearch.parse({ again: true })).toEqual({ again: true });
    expect(tryAgainSearch.parse({ again: false })).toEqual({ again: false });
  });

  it("reads anything else as an ordinary visit", () => {
    expect(tryAgainSearch.parse({ again: "yes" })).toEqual({
      again: undefined,
    });
    expect(tryAgainSearch.parse({})).toEqual({});
  });
});
