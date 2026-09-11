import { describe, expect, it } from "vitest";

import { climateBands } from "../../src/modules/closet";
import {
  BAND_WITHOUT_LOCATION,
  climateBandFor,
} from "../../src/modules/onboarding/climate";

/**
 * The heuristic the packet asked to have documented: latitude alone, and
 * the case it must get right is Minneapolis gets mittens, Phoenix does not.
 */
describe("climateBandFor", () => {
  it("puts Minneapolis in cold and Phoenix in mild", () => {
    // The packet's own example, and the reason the boundary is 40 rather
    // than a round 45: Minneapolis is at 44.98, so 45 puts it on the warm
    // side of the line by two hundredths of a degree. This assertion is
    // what caught that.
    expect(climateBandFor(44.98)).toBe("cold");
    expect(climateBandFor(33.45)).toBe("mild");
  });

  it("puts the tropics in hot", () => {
    expect(climateBandFor(1.35)).toBe("hot");
  });

  it("reads the southern hemisphere the same as the northern", () => {
    // Wellington and Toronto are the same band; a version without
    // `Math.abs` would hand every southern runner the hot list.
    expect(climateBandFor(-41.29)).toBe(climateBandFor(43.65));
    expect(climateBandFor(-33.87)).toBe("mild");
  });

  it("takes the colder band exactly on each boundary", () => {
    // `>=`, not `>`: a runner exactly on the line gets the band whose list
    // carries the garment they may own, which is the cheaper mistake.
    expect(climateBandFor(40)).toBe("cold");
    expect(climateBandFor(30)).toBe("mild");
  });

  it("takes the warmer band just below each boundary", () => {
    expect(climateBandFor(39.99)).toBe("mild");
    expect(climateBandFor(29.99)).toBe("hot");
  });

  it("keeps the northern US cities that have real winters in cold", () => {
    // Chicago and New York sit between the two candidate boundaries, so
    // they are the ones that move if someone raises it back toward 45.
    expect(climateBandFor(41.88)).toBe("cold");
    expect(climateBandFor(40.71)).toBe("cold");
  });

  it("falls back to a band the closet actually has a list for", () => {
    // A denied location must not block onboarding, and the fallback has to
    // be a real band — parsed through the closet's own schema rather than
    // written as a string this module hopes is still valid.
    expect(climateBands).toContain(BAND_WITHOUT_LOCATION);
    expect(BAND_WITHOUT_LOCATION).toBe("mild");
  });
});
