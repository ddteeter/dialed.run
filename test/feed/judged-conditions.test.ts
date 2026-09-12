import { describe, expect, it } from "vitest";
import { z } from "zod";

import { verdictScale } from "../../src/lib/contracts";
import { pointSpan } from "../../src/modules/feed/conditions-shape";
import type { Conditions } from "../../src/modules/feed/conditions-shape";
import { judgedFeelsLikeC } from "../../src/modules/feed/judged-conditions";

/**
 * Which hour a run is judged at (D-5, owner's call 2026-09-11).
 *
 * A 9-11am run that begins at 4° and ends at 12° carries one verdict for
 * the whole thing. Banding it at 4° is what teaches the call epic that 4°
 * means overdressed.
 */
/**
 * An unrated entry's verdict. Parsed rather than written, the way
 * `test/modules/closet-fixtures.ts` does it: drizzle types the column as
 * `number | null` and `unicorn/no-null` forbids the literal.
 */
const NO_VERDICT = z.null().parse(JSON.parse("null"));

const SPANNING: Conditions = {
  tempC: 4,
  feelsLikeC: 4,
  precipMm: 0,
  condition: "clear",
  windKph: 5,
  source: "visualcrossing",
  span: { minTempC: 2, maxTempC: 14, minFeelsLikeC: 2, maxFeelsLikeC: 12 },
};

describe("judgedFeelsLikeC", () => {
  it("takes the coldest hour when the runner felt cold", () => {
    // -1 and -2 both mean cold; the coldest hour is the one the outfit
    // failed in.
    expect(judgedFeelsLikeC(SPANNING, -1)).toBe(2);
    expect(judgedFeelsLikeC(SPANNING, -2)).toBe(2);
  });

  it("takes the warmest hour when the runner felt warm", () => {
    expect(judgedFeelsLikeC(SPANNING, 1)).toBe(12);
    expect(judgedFeelsLikeC(SPANNING, 2)).toBe(12);
  });

  it("takes the hour they dressed for when the verdict was dialed", () => {
    // A dialed run has no worst hour — the outfit held across the span.
    expect(judgedFeelsLikeC(SPANNING, 0)).toBe(4);
  });

  it("takes the hour they dressed for when there is no verdict yet", () => {
    // `itemWearInBand` bands unrated entries, so this is reachable.
    expect(judgedFeelsLikeC(SPANNING, NO_VERDICT)).toBe(4);
  });

  it("answers the same value whatever the verdict, for a run inside one hour", () => {
    const single: Conditions = { ...SPANNING, span: pointSpan(4, 4) };
    const answers = [-2, -1, 0, 1, 2, NO_VERDICT].map((v) =>
      judgedFeelsLikeC(single, v),
    );

    expect(new Set(answers)).toStrictEqual(new Set([4]));
  });

  it("reads cold as negative and warm as positive, the way verdictScale does", () => {
    // Pinned against the scale rather than restating it: if the sign
    // convention ever flips, this fails instead of every band quietly
    // inverting (CLAUDE.md, derive don't mirror).
    for (const { value, token } of verdictScale) {
      const judged = judgedFeelsLikeC(SPANNING, value);
      if (token.includes("cold")) expect(judged).toBe(SPANNING.span.minFeelsLikeC);
      else if (token.includes("warm")) expect(judged).toBe(SPANNING.span.maxFeelsLikeC);
      else expect(judged).toBe(SPANNING.feelsLikeC);
    }
  });
});
