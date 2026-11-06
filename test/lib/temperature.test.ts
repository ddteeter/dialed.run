import { describe, expect, it } from "vitest";

import {
  bandFloorC,
  bandLabel,
  formatTemp,
  precipClassOf,
  tempInUnit,
  unitToC,
} from "../../src/lib/contracts/temperature";
import type { TempUnit } from "../../src/lib/contracts";

/**
 * `lib/contracts/temperature` had no test of its own — it was executed only
 * incidentally, through feed and weather tests that assert something else.
 * Mutation testing put a number on that: 14% score, 21 of 35 mutants never
 * executed at all.
 *
 * It is worth its own file because everything here is a boundary or a unit
 * conversion, and both fail silently. A band floor off by one moves a run
 * into the wrong coverage bucket; a wrong `cToF` shows a plausible number
 * that is simply not the temperature.
 *
 * These assert the boundaries themselves, not points comfortably inside a
 * range — an assertion at 1.0mm cannot tell `<= 2.5` from `< 2.5`.
 */

describe("precipClassOf", () => {
  it("splits dry from damp exactly at 0.1mm", () => {
    expect(precipClassOf(0)).toBe("dry");
    expect(precipClassOf(0.1)).toBe("dry");
    expect(precipClassOf(0.11)).toBe("damp");
  });

  it("splits damp from wet exactly at 2.5mm", () => {
    expect(precipClassOf(2.5)).toBe("damp");
    expect(precipClassOf(2.51)).toBe("wet");
    expect(precipClassOf(12)).toBe("wet");
  });
});

describe("bandFloorC", () => {
  it("floors to the 5° band containing the value", () => {
    expect(bandFloorC(0)).toBe(0);
    expect(bandFloorC(4.9)).toBe(0);
    expect(bandFloorC(5)).toBe(5);
    expect(bandFloorC(9.9)).toBe(5);
    expect(bandFloorC(12)).toBe(10);
  });

  it("floors downward below zero, rather than toward zero", () => {
    // The distinction `Math.floor` makes and `Math.trunc` does not: -1°C
    // belongs to the -5 band, not the 0 band. Getting this wrong puts a
    // cold run in the same bucket as a mild one.
    expect(bandFloorC(-0.1)).toBe(-5);
    expect(bandFloorC(-5)).toBe(-5);
    expect(bandFloorC(-5.1)).toBe(-10);
  });
});

describe("bandLabel", () => {
  it("spans five degrees in celsius", () => {
    expect(bandLabel(5, "c")).toBe("5–10°");
    expect(bandLabel(-5, "c")).toBe("-5–0°");
  });

  it("converts both ends to fahrenheit", () => {
    // 5°C = 41°F and 10°C = 50°F. Both ends are asserted because a
    // conversion applied to only one of them still produces a plausible
    // range.
    expect(bandLabel(5, "f")).toBe("41–50°");
    expect(bandLabel(0, "f")).toBe("32–41°");
  });

  it("agrees with the anchors everyone knows", () => {
    // 0°C = 32°F, -40 is where the scales meet. A wrong multiplier or a
    // wrong offset breaks one of these.
    expect(formatTemp(0, "f")).toBe("32°");
    expect(formatTemp(100, "f")).toBe("212°");
    expect(formatTemp(-40, "f")).toBe("-40°");
  });
});

describe("formatTemp", () => {
  it("rounds rather than truncating", () => {
    expect(formatTemp(12.4, "c")).toBe("12°");
    expect(formatTemp(12.5, "c")).toBe("13°");
    // -0.4 rounds to -0, and String(-0) is "0" — the sign does not survive,
    // which is what we want on screen.
    expect(formatTemp(-0.4, "c")).toBe("0°");
  });

  it("rounds after converting, not before", () => {
    // 12.4°C is 54.32°F -> 54. Rounding to 12°C first and converting gives
    // 54 as well, so the distinguishing input is one where the two differ:
    // 12.6°C is 54.68°F -> 55, but rounding first gives 13°C -> 55. Use a
    // value where they part: 21.7°C is 71.06°F -> 71; rounded first, 22°C
    // -> 72.
    expect(formatTemp(21.7, "f")).toBe("71°");
  });
});

describe("tempInUnit", () => {
  it("is the whole number a reader sees, in their unit", () => {
    expect(tempInUnit(3.4, "c")).toBe(3);
    expect(tempInUnit(3.6, "c")).toBe(4);
    expect(tempInUnit(0, "f")).toBe(32);
    expect(tempInUnit(-40, "f")).toBe(-40);
    expect(tempInUnit(1.1, "f")).toBe(34);
  });
});

/**
What a runner reads after a number goes to Celsius and back.
*/
function roundTrip(value: number, unit: TempUnit): string {
  return String(tempInUnit(unitToC(value, unit), unit));
}

// Celsius to a tenth: six decimals tells 5.3 from an unrounded 5.26.
const TENTH = 6;

describe("unitToC", () => {
  it("takes Celsius as it is, to a tenth", () => {
    expect(unitToC(5, "c")).toBe(5);
    expect(unitToC(5.26, "c")).toBeCloseTo(5.3, TENTH);
    expect(unitToC(-5.26, "c")).toBeCloseTo(-5.3, TENTH);
  });

  it("converts Fahrenheit, to a tenth", () => {
    expect(unitToC(32, "f")).toBe(0);
    expect(unitToC(34, "f")).toBeCloseTo(1.1, TENTH);
    expect(unitToC(-40, "f")).toBe(-40);
  });

  /**
   * Closet C's WORKS AT writes a runner's number into the URL in Celsius
   * and reads it back in their unit. Every whole degree has to survive
   * that, or the control moves under the runner's thumb. The span runs
   * well past any temperature anyone runs in.
   *
   * Compared as text, because that is what the runner reads: 0°F comes
   * back from −17.8°C as `Math.round(-0.04)`, which is −0, and −0 prints
   * as "0".
   */
  it("round-trips every whole degree in both units", () => {
    for (let fahrenheit = -60; fahrenheit <= 130; fahrenheit += 1) {
      expect(roundTrip(fahrenheit, "f")).toBe(String(fahrenheit));
    }
    for (let celsius = -50; celsius <= 55; celsius += 1) {
      expect(roundTrip(celsius, "c")).toBe(String(celsius));
    }
  });
});
