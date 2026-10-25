import { describe, expect, it } from "vitest";

import { effortFromWatch } from "../../src/lib/contracts";

/**
 * Design G5's mapping, pinned at every boundary (owner, 2026-10-24): 1–4
 * easy, 5–6 steady, 7–8 workout, 9–10 race.
 */
describe("effortFromWatch", () => {
  it.each([
    [1, "easy"],
    [4, "easy"],
    [5, "steady"],
    [6, "steady"],
    [7, "workout"],
    [8, "workout"],
    [9, "race"],
    [10, "race"],
  ] as const)("prefills RPE %i as %s, chosen by the watch", (rpe, effort) => {
    expect(effortFromWatch(rpe)).toEqual({
      rpe,
      effort,
      effortSource: "watch",
    });
  });

  it("fills nothing when the watch did not ask", () => {
    expect(effortFromWatch(undefined)).toBeUndefined();
  });
});
