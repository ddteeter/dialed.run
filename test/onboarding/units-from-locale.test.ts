import { describe, expect, it } from "vitest";

import { defaultUnits } from "../../src/lib/contracts";
import { unitsFromLocale } from "../../src/modules/onboarding/units-from-locale";

/**
 * The units O1 *offers*, from `Accept-Language`.
 *
 * Every case here is a real header a real browser sends. The one that
 * decides the shape of the code is the UK: a single "is this metric"
 * boolean gets Britain wrong whichever way it is set, so the two lists are
 * separate and this file is what keeps them that way.
 */
describe("unitsFromLocale", () => {
  it("gives an American Fahrenheit and miles", () => {
    expect(unitsFromLocale("en-US,en;q=0.9")).toEqual({
      temp: "f",
      distance: "mi",
    });
  });

  it("gives a Briton Celsius and miles", () => {
    // Britain reads temperature in Celsius and distance in miles. This is
    // the case that stops the two lists being merged.
    expect(unitsFromLocale("en-GB,en;q=0.9")).toEqual({
      temp: "c",
      distance: "mi",
    });
  });

  it("gives a Canadian Celsius and kilometres", () => {
    // The near-miss for "English means Fahrenheit".
    expect(unitsFromLocale("en-CA,fr-CA;q=0.8")).toEqual({
      temp: "c",
      distance: "km",
    });
  });

  it("gives every US territory what the US gets", () => {
    // They report as their own region, so `en-US` never covers them — and
    // each entry in the table is named here rather than iterated over it,
    // because a test that loops the list it is checking passes when the
    // list empties.
    for (const region of ["PR", "GU", "VI", "AS"]) {
      expect(unitsFromLocale(`en-${region}`)).toEqual({
        temp: "f",
        distance: "mi",
      });
    }
  });

  it("gives Myanmar and Liberia miles, and Celsius with them", () => {
    // The other two non-metric road systems. They are on the distance list
    // and not on the temperature one, which is the same split Britain
    // makes and the reason there are two lists at all.
    expect(unitsFromLocale("my-MM")).toEqual({ temp: "c", distance: "mi" });
    expect(unitsFromLocale("en-LR")).toEqual({ temp: "c", distance: "mi" });
  });

  it("gives the rest of the world Celsius and kilometres", () => {
    expect(unitsFromLocale("de-DE,de;q=0.9,en;q=0.8")).toEqual({
      temp: "c",
      distance: "km",
    });
  });

  it("does not read a region out of the middle of a script subtag", () => {
    // `en-Latn-US` is the case both regex anchors exist for. Unanchored,
    // `[A-Za-z]{2}` matches inside "Latn", so the region reads as "LATN"
    // and an American is handed Celsius and kilometres.
    expect(unitsFromLocale("en-Latn-US")).toEqual({
      temp: "f",
      distance: "mi",
    });
  });

  it("ignores whitespace around the tag", () => {
    // A stray space makes the region "GB " rather than "GB", which matches
    // nothing and falls back.
    //
    // **`en-GB`, not `en-US`, and that is the whole test.** With the US the
    // fallback *is* the right answer, so the assertion holds whether or not
    // anything is trimmed — it passes while testing nothing. Britain is the
    // nearest locale whose answer differs from `defaultUnits`, so the
    // untrimmed version gets Fahrenheit and fails.
    expect(unitsFromLocale("  en-GB  ,en;q=0.9")).toEqual({
      temp: "c",
      distance: "mi",
    });
  });

  it("reads the region past a script subtag", () => {
    // `zh-Hans-CN`: the region is third, not second. A naive `split("-")[1]`
    // would read "Hans" and find it in neither list — right answer here by
    // luck, wrong the moment a two-letter script appears.
    expect(unitsFromLocale("zh-Hans-CN")).toEqual({
      temp: "c",
      distance: "km",
    });
  });

  it("takes the region from the first tag only", () => {
    // An `Accept-Language` is a list of languages someone reads, not places
    // they live. A Briton who also reads American English is still a
    // Briton, and reading the last entry would hand them Fahrenheit.
    expect(unitsFromLocale("en-GB,en-US;q=0.9")).toEqual({
      temp: "c",
      distance: "mi",
    });
  });

  it("falls back rather than guessing which English", () => {
    // A bare `en` names no place. Guessing "American" from it is how a
    // header with no region becomes a wrong unit the user has to notice.
    expect(unitsFromLocale("en")).toEqual(defaultUnits);
    expect(unitsFromLocale("en;q=0.9")).toEqual(defaultUnits);
  });

  it("falls back when there is no header at all", () => {
    // Two shapes of "no header" and both must land on the defaults rather
    // than throw, because this runs on the signup path.
    //
    // The absent one comes from a real `Headers` rather than a `null`
    // literal — `unicorn/no-null` forbids the literal, and asking the
    // actual caller is the better test anyway: `functions.ts` passes
    // `getRequestHeaders().get("accept-language")` straight through, so
    // this is that value and not an impression of it.
    expect(unitsFromLocale(new Headers().get("accept-language"))).toEqual(
      defaultUnits,
    );
    expect(unitsFromLocale(undefined)).toEqual(defaultUnits);
    expect(unitsFromLocale("")).toEqual(defaultUnits);
  });

  it("does not care about case", () => {
    // Rare, but legal: the region subtag is conventionally upper-case and
    // nothing enforces it.
    expect(unitsFromLocale("en-us")).toEqual({ temp: "f", distance: "mi" });
  });
});
