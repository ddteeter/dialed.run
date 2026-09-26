import { describe, expect, it } from "vitest";
import { z } from "zod";

import {
  SET_CONDITION_BANDS,
  BAND_OPTIONS,
  SKY_WORDS,
  bandFloorOf,
  bandMiddleC,
  conditionsPickSchema,
  setBandLabel,
  canSetConditions,
} from "../../src/modules/runs/run-conditions";

/**
 * R2b's rules (round 22): the runner picks from what it offers and never
 * types a number, and weather that arrived is never editable.
 */

describe("SET_CONDITION_BANDS", () => {
  it("offers twelve 5 °C bands from −20 to 40", () => {
    expect(SET_CONDITION_BANDS).toStrictEqual([
      -20, -15, -10, -5, 0, 5, 10, 15, 20, 25, 30, 35,
    ]);
  });
});

describe("bandMiddleC", () => {
  it("stores a band at its middle", () => {
    expect(bandMiddleC(10)).toBe(12.5);
    expect(bandMiddleC(-20)).toBe(-17.5);
  });
});

describe("bandFloorOf and setBandLabel: a set band reads back as its range", () => {
  it("finds the band a stored middle came from", () => {
    expect(bandFloorOf(12.5)).toBe(10);
    expect(bandFloorOf(bandMiddleC(-20))).toBe(-20);
  });

  it("labels it in the runner's unit, never as the middle", () => {
    // Round 26, item 2: "SET · 41–50° · RAIN", never 45.5°.
    expect(setBandLabel(7.5, "f")).toBe("41–50°");
    expect(setBandLabel(7.5, "c")).toBe("5–10°");
  });
});

describe("conditionsPickSchema: R2b's two required picks", () => {
  it("takes a band's radio value and a sky, and gives the band back as a number", () => {
    expect(
      conditionsPickSchema.parse({ bandFloorC: "-20", sky: "damp" }),
    ).toStrictEqual({ bandFloorC: -20, sky: "damp" });
  });

  it("refuses a missing band with the board's sentence", () => {
    for (const bandFloorC of ["", "12", "40"]) {
      const result = conditionsPickSchema.safeParse({ bandFloorC, sky: "dry" });
      expect(result.error?.issues[0]?.message, bandFloorC).toBe(
        "Pick how warm it was.",
      );
    }
  });

  it("refuses a missing sky with the board's sentence", () => {
    const result = conditionsPickSchema.safeParse({
      bandFloorC: "10",
      sky: "",
    });
    expect(result.error?.issues[0]?.message).toBe("Pick the sky.");
  });

  it("offers every band as a radio value, coldest first", () => {
    expect(BAND_OPTIONS).toStrictEqual(SET_CONDITION_BANDS.map(String));
  });
});

describe("SKY_WORDS", () => {
  it("names the four skies with E2-lite's words", () => {
    expect(SKY_WORDS).toStrictEqual({
      dry: "Dry",
      damp: "Damp",
      rain: "Rain",
      snow: "Snow",
    });
  });
});

describe("canSetConditions", () => {
  const located = { lat: 44.98, lng: -93.27 };

  it("offers R2b for a located run the weather gave up on", () => {
    expect(canSetConditions({ weatherStatus: "failed", ...located })).toBe(
      true,
    );
  });

  it("never for weather that arrived, one still being asked for, or indoors", () => {
    for (const weatherStatus of ["attached", "manual", "pending", "none"]) {
      expect(
        canSetConditions({ weatherStatus, ...located }),
        weatherStatus,
      ).toBe(false);
    }
  });

  it("never for a run with no place to key an observation on — either half missing", () => {
    // SQL NULL, as the column holds it.
    const NOWHERE = z.null().parse(JSON.parse("null"));
    expect(
      canSetConditions({ weatherStatus: "failed", lat: NOWHERE, lng: -93.27 }),
    ).toBe(false);
    expect(
      canSetConditions({ weatherStatus: "failed", lat: 44.98, lng: NOWHERE }),
    ).toBe(false);
  });
});
