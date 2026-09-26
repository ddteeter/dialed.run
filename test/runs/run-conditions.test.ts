import { describe, expect, it } from "vitest";
import { z } from "zod";

import {
  SET_CONDITION_BANDS,
  bandMiddleC,
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
