import { describe, expect, it } from "vitest";

import { climateBands } from "../../src/modules/closet";
import {
  BAND_WITHOUT_LOCATION,
  bandFromNormals,
  climateBandFor,
  resolveClimateBand,
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

/**
 * The band from measured normals. Every number below is what Visual
 * Crossing's `include=stats` actually returned on 2026-09-11 — recorded
 * here so the thresholds are pinned against real places rather than
 * against themselves.
 */
const NORMALS = {
  minneapolis: { winterLowC: -12.1, summerHighC: 28.7 },
  denver: { winterLowC: -8, summerHighC: 31 },
  reykjavik: { winterLowC: -2.8, summerHighC: 14 },
  seattle: { winterLowC: 1.3, summerHighC: 24.1 },
  phoenix: { winterLowC: 6.5, summerHighC: 42 },
};

describe("bandFromNormals", () => {
  it("bands the five cities the way their wardrobes actually differ", () => {
    expect(bandFromNormals(NORMALS.minneapolis)).toBe("cold");
    expect(bandFromNormals(NORMALS.denver)).toBe("cold");
    expect(bandFromNormals(NORMALS.reykjavik)).toBe("mild");
    expect(bandFromNormals(NORMALS.seattle)).toBe("mild");
    expect(bandFromNormals(NORMALS.phoenix)).toBe("hot");
  });

  it("disagrees with latitude for four of those five", () => {
    // The reason normals exist here at all. If this ever passes with a
    // smaller number, the heuristic got better or the thresholds got
    // worse, and either is worth looking at.
    const cities = [
      { normals: NORMALS.minneapolis, lat: 44.98 },
      { normals: NORMALS.denver, lat: 39.74 },
      { normals: NORMALS.reykjavik, lat: 64.15 },
      { normals: NORMALS.seattle, lat: 47.61 },
      { normals: NORMALS.phoenix, lat: 33.45 },
    ];
    const disagreements = cities.filter(
      (city) => bandFromNormals(city.normals) !== climateBandFor(city.lat),
    );

    expect(disagreements).toHaveLength(4);
  });

  it("calls a place cold on the winter low, whatever its summers do", () => {
    // Denver at 31.0 sits just under the hot line on purpose: its winters
    // are what its wardrobe is built around.
    expect(bandFromNormals({ winterLowC: -5, summerHighC: 45 })).toBe("cold");
  });

  it("takes each threshold at its boundary", () => {
    expect(bandFromNormals({ winterLowC: -5, summerHighC: 20 })).toBe("cold");
    expect(bandFromNormals({ winterLowC: -4.9, summerHighC: 20 })).toBe("mild");
    expect(bandFromNormals({ winterLowC: 10, summerHighC: 32 })).toBe("hot");
    expect(bandFromNormals({ winterLowC: 10, summerHighC: 31.9 })).toBe("mild");
  });
});

describe("resolveClimateBand", () => {
  it("prefers what the weather says", async () => {
    // Phoenix: latitude says mild, normals say hot.
    const band = await resolveClimateBand(33.45, -112.07, () =>
      Promise.resolve(NORMALS.phoenix),
    );

    expect(band).toBe("hot");
  });

  it("falls back to latitude when the provider fails", async () => {
    // Onboarding must not block on a third party (law 5). Seattle's
    // fallback is *wrong* — latitude says cold, normals say mild — and
    // that is the accepted cost: a plausible list a tap can fix.
    const band = await resolveClimateBand(47.61, -122.33, () =>
      Promise.reject(new Error("provider down")),
    );

    expect(band).toBe("cold");
  });

  it("asks the provider for the coordinates it was given", async () => {
    const seen: [number, number][] = [];
    await resolveClimateBand(44.98, -93.27, (lat, lng) => {
      seen.push([lat, lng]);
      return Promise.resolve(NORMALS.minneapolis);
    });

    expect(seen).toStrictEqual([[44.98, -93.27]]);
  });
});
