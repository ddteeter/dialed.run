import { describe, expect, it } from "vitest";

import {
  choicesOf,
  COUNTRIES,
  REGION_COUNTRY_UNKNOWN,
  REGION_SUBDIVISION_ALONE,
  REGION_SUBDIVISION_ELSEWHERE,
  regionInput,
  regionLabel,
  subdivisionsOf,
} from "../../src/lib/contracts/regions";

/**
 * Settings › Region's list and schema (round 30 (d)): ISO 3166-1 countries,
 * and ISO 3166-2 subdivisions where the list has them.
 */
function messagesOf(input: unknown): string[] {
  const result = regionInput.safeParse(input);
  return result.success
    ? []
    : result.error.issues.map((issue) => issue.message);
}

describe("the country list", () => {
  it("holds every ISO 3166-1 country once, by name, in name order", () => {
    expect(COUNTRIES).toHaveLength(249);
    const codes = COUNTRIES.map((country) => country.code);
    expect(new Set(codes).size).toBe(codes.length);
    for (const country of COUNTRIES) {
      expect(country.code).toMatch(/^[A-Z]{2}$/u);
      expect(country.name).not.toBe("");
    }
    // Written down rather than read from `Intl.DisplayNames`: its names
    // follow the runtime's ICU (workerd says "Falkland Islands (Islas
    // Malvinas)", Node says "Falkland Islands"), and a select rendered on
    // the server and hydrated in a browser must say the same thing.
    expect(COUNTRIES).toContainEqual({ code: "US", name: "United States" });
    expect(COUNTRIES).toContainEqual({ code: "CI", name: "Côte d’Ivoire" });
    expect(COUNTRIES.at(0)).toStrictEqual({
      code: "AF",
      name: "Afghanistan",
    });
    expect(COUNTRIES.at(-1)).toStrictEqual({ code: "ZW", name: "Zimbabwe" });
    const names = COUNTRIES.map((country) => country.name);
    expect(names).toStrictEqual(
      names.toSorted((a, b) => a.localeCompare(b, "en")),
    );
  });
});

describe("subdivisionsOf", () => {
  it("offers the US states and DC, and Canada's provinces and territories", () => {
    const us = subdivisionsOf("US");
    expect(us).toHaveLength(51);
    expect(us.at(0)).toStrictEqual({ code: "US-AL", name: "Alabama" });
    expect(us.at(-1)).toStrictEqual({ code: "US-WY", name: "Wyoming" });
    expect(us).toContainEqual({ code: "US-MN", name: "Minnesota" });
    expect(us).toContainEqual({ code: "US-DC", name: "District of Columbia" });
    const ca = subdivisionsOf("CA");
    expect(ca).toHaveLength(13);
    expect(ca.at(0)).toStrictEqual({ code: "CA-AB", name: "Alberta" });
    expect(ca.at(-1)).toStrictEqual({ code: "CA-YT", name: "Yukon" });
    expect(ca).toContainEqual({
      code: "CA-NL",
      name: "Newfoundland and Labrador",
    });
  });

  it("offers none for a country the list has none for, or for no country", () => {
    expect(subdivisionsOf("NO")).toStrictEqual([]);
    expect(subdivisionsOf("")).toStrictEqual([]);
  });
});

describe("choicesOf", () => {
  it("gives a select its codes in order and each code's name", () => {
    expect(
      choicesOf([
        { code: "US-MN", name: "Minnesota" },
        { code: "US-WI", name: "Wisconsin" },
      ]),
    ).toStrictEqual({
      codes: ["US-MN", "US-WI"],
      names: { "US-MN": "Minnesota", "US-WI": "Wisconsin" },
    });
  });
});

describe("regionInput", () => {
  it("takes a country and one of its subdivisions", () => {
    expect(
      regionInput.parse({ country: "US", subdivision: "US-MN" }),
    ).toStrictEqual({ country: "US", subdivision: "US-MN" });
  });

  it("takes a country alone, with no subdivision or the select's empty choice", () => {
    expect(regionInput.parse({ country: "NO" })).toStrictEqual({
      country: "NO",
    });
    expect(regionInput.parse({ country: "US", subdivision: "" })).toStrictEqual(
      { country: "US", subdivision: undefined },
    );
  });

  it("reads nothing chosen as a clear", () => {
    expect(regionInput.parse({ country: "", subdivision: "" })).toStrictEqual({
      country: undefined,
      subdivision: undefined,
    });
    expect(regionInput.parse({})).toStrictEqual({});
  });

  it("refuses a country not in the list", () => {
    expect(messagesOf({ country: "XX" })).toStrictEqual([
      REGION_COUNTRY_UNKNOWN,
    ]);
    expect(messagesOf({ country: "us" })).toStrictEqual([
      REGION_COUNTRY_UNKNOWN,
    ]);
    expect(REGION_COUNTRY_UNKNOWN).toBe("Pick a country from the list.");
  });

  it("refuses a subdivision without a country, on the subdivision", () => {
    for (const input of [
      { subdivision: "US-MN" },
      { country: "", subdivision: "US-MN" },
    ]) {
      const result = regionInput.safeParse(input);
      expect(result.success).toBe(false);
      expect(result.error?.issues).toMatchObject([
        { path: ["subdivision"], message: REGION_SUBDIVISION_ALONE },
      ]);
    }
    expect(REGION_SUBDIVISION_ALONE).toBe(
      "Pick a country before a state or province.",
    );
  });

  it("refuses another country's subdivision, or one the country does not have", () => {
    const result = regionInput.safeParse({
      country: "CA",
      subdivision: "US-MN",
    });
    expect(result.error?.issues).toMatchObject([
      { path: ["subdivision"], message: REGION_SUBDIVISION_ELSEWHERE },
    ]);
    expect(messagesOf({ country: "NO", subdivision: "NO-03" })).toStrictEqual([
      REGION_SUBDIVISION_ELSEWHERE,
    ]);
    expect(REGION_SUBDIVISION_ELSEWHERE).toBe(
      "Pick a state or province in that country.",
    );
  });

  it("refuses anything but text", () => {
    expect(regionInput.safeParse({ country: 1 }).success).toBe(false);
    expect(
      regionInput.safeParse({ country: "US", subdivision: 2 }).success,
    ).toBe(false);
  });
});

describe("regionLabel", () => {
  it("says the subdivision and its country, the country alone, or nothing", () => {
    expect(regionLabel({ country: "US", subdivision: "US-MN" })).toBe(
      "Minnesota, United States",
    );
    expect(regionLabel({ country: "NO" })).toBe("Norway");
    expect(regionLabel({})).toBeUndefined();
  });

  it("shows a stored code the list no longer holds rather than dropping it", () => {
    expect(regionLabel({ country: "XK" })).toBe("XK");
    expect(regionLabel({ country: "US", subdivision: "US-PR" })).toBe(
      "US-PR, United States",
    );
  });
});
