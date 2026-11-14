import { describe, expect, it } from "vitest";

import { chipPlaceName } from "../../src/modules/onboarding/place-name";

/**
 * R55·228: O1's chip names a place as city, region, country, the region by
 * its postal abbreviation where one exists, county and district dropped.
 */
describe("chipPlaceName", () => {
  it("drops the county and abbreviates the state: the ruling's own example", () => {
    expect(
      chipPlaceName("Minneapolis, Hennepin County, Minnesota, United States"),
    ).toBe("Minneapolis, MN, United States");
  });

  it("keeps an abbreviation the provider already gave", () => {
    expect(chipPlaceName("Portland, OR, United States")).toBe(
      "Portland, OR, United States",
    );
  });

  it("drops a district too, in any case", () => {
    expect(
      chipPlaceName("Kowloon, Yau Tsim Mong DISTRICT, Hong Kong, China"),
    ).toBe("Kowloon, Hong Kong, China");
  });

  it("does not drop a part that only contains the word inside another", () => {
    expect(chipPlaceName("Countyline, Oklahoma, United States")).toBe(
      "Countyline, OK, United States",
    );
  });

  it("abbreviates Canadian provinces and Australian states", () => {
    expect(chipPlaceName("Toronto, Ontario, Canada")).toBe(
      "Toronto, ON, Canada",
    );
    expect(chipPlaceName("Montréal, Québec, Canada")).toBe(
      "Montréal, QC, Canada",
    );
    expect(chipPlaceName("Sydney, New South Wales, Australia")).toBe(
      "Sydney, NSW, Australia",
    );
  });

  it("matches a region's name and its country's whatever their case", () => {
    expect(chipPlaceName("Duluth, MINNESOTA, united states")).toBe(
      "Duluth, MN, united states",
    );
    expect(chipPlaceName("Boise, Idaho, USA")).toBe("Boise, ID, USA");
    expect(chipPlaceName("Boise, Idaho, United States of America")).toBe(
      "Boise, ID, United States of America",
    );
  });

  it("keeps a region's name where its country has no postal abbreviations", () => {
    expect(
      chipPlaceName("Manchester, Greater Manchester, England, United Kingdom"),
    ).toBe("Manchester, England, United Kingdom");
    expect(chipPlaceName("Lyon, Auvergne-Rhône-Alpes, France")).toBe(
      "Lyon, Auvergne-Rhône-Alpes, France",
    );
  });

  it("does not take one country's abbreviation for another's region", () => {
    // Washington is WA in the United States; in Canada it is no province.
    expect(chipPlaceName("Somewhere, Washington, Canada")).toBe(
      "Somewhere, Washington, Canada",
    );
  });

  it("leaves a name with no region as it is, without empty parts", () => {
    expect(chipPlaceName("Singapore, Singapore")).toBe("Singapore, Singapore");
    expect(chipPlaceName(" Reykjavík ,, Iceland ")).toBe("Reykjavík, Iceland");
    expect(chipPlaceName("Nowhere")).toBe("Nowhere");
    expect(chipPlaceName("Bend, Deschutes County, United States")).toBe(
      "Bend, United States",
    );
  });

  it("abbreviates every US state, Canadian province and Australian state to two or three capitals", () => {
    const regions: readonly (readonly [string, string])[] = [
      ["Alabama", "United States"],
      ["Alaska", "United States"],
      ["Arizona", "United States"],
      ["Arkansas", "United States"],
      ["California", "United States"],
      ["Colorado", "United States"],
      ["Connecticut", "United States"],
      ["Delaware", "United States"],
      ["Florida", "United States"],
      ["Georgia", "United States"],
      ["Hawaii", "United States"],
      ["Idaho", "United States"],
      ["Illinois", "United States"],
      ["Indiana", "United States"],
      ["Iowa", "United States"],
      ["Kansas", "United States"],
      ["Kentucky", "United States"],
      ["Louisiana", "United States"],
      ["Maine", "United States"],
      ["Maryland", "United States"],
      ["Massachusetts", "United States"],
      ["Michigan", "United States"],
      ["Minnesota", "United States"],
      ["Mississippi", "United States"],
      ["Missouri", "United States"],
      ["Montana", "United States"],
      ["Nebraska", "United States"],
      ["Nevada", "United States"],
      ["New Hampshire", "United States"],
      ["New Jersey", "United States"],
      ["New Mexico", "United States"],
      ["New York", "United States"],
      ["North Carolina", "United States"],
      ["North Dakota", "United States"],
      ["Ohio", "United States"],
      ["Oklahoma", "United States"],
      ["Oregon", "United States"],
      ["Pennsylvania", "United States"],
      ["Puerto Rico", "United States"],
      ["Rhode Island", "United States"],
      ["South Carolina", "United States"],
      ["South Dakota", "United States"],
      ["Tennessee", "United States"],
      ["Texas", "United States"],
      ["Utah", "United States"],
      ["Vermont", "United States"],
      ["Virginia", "United States"],
      ["Washington", "United States"],
      ["West Virginia", "United States"],
      ["Wisconsin", "United States"],
      ["Wyoming", "United States"],
      ["Alberta", "Canada"],
      ["British Columbia", "Canada"],
      ["Manitoba", "Canada"],
      ["New Brunswick", "Canada"],
      ["Newfoundland and Labrador", "Canada"],
      ["Northwest Territories", "Canada"],
      ["Nova Scotia", "Canada"],
      ["Nunavut", "Canada"],
      ["Ontario", "Canada"],
      ["Prince Edward Island", "Canada"],
      ["Quebec", "Canada"],
      ["Saskatchewan", "Canada"],
      ["Yukon", "Canada"],
      ["Australian Capital Territory", "Australia"],
      ["Northern Territory", "Australia"],
      ["Queensland", "Australia"],
      ["South Australia", "Australia"],
      ["Tasmania", "Australia"],
      ["Victoria", "Australia"],
      ["Western Australia", "Australia"],
    ];
    for (const [region, country] of regions) {
      const [, short] = chipPlaceName(`Town, ${region}, ${country}`).split(
        ", ",
       2,);
      expect(short, region).toMatch(/^[A-Z]{2,3}$/u);
    }
    // District of Columbia is a district by name, so it is dropped first.
    expect(
      chipPlaceName("Washington, District of Columbia, United States"),
    ).toBe("Washington, United States");
  });
});
