import { describe, expect, it } from "vitest";

import {
  BAND_COVERED_VERDICTS,
  CALL_VERDICT_THRESHOLD,
} from "../../src/lib/contracts";
import type { CoverageBand } from "../../src/modules/feed";
import {
  bandCoverage,
  ladderFrom,
  verdictsIn,
} from "../../src/modules/onboarding/ladder";

/**
 * The Call tab's ladder (D-16, O6). "Coverage is the progress bar — not run
 * count": a runner with forty verdicts all at 50° is still guessing in
 * January, so the screen has to show the bands they have *not* covered.
 */
function band(bandFloorC: number, counts: Partial<CoverageBand> = {}): CoverageBand {
  return {
    bandFloorC,
    label: `${String(bandFloorC)}°`,
    cold: 0,
    dialed: 0,
    warm: 0,
    ...counts,
  };
}

describe("bandCoverage", () => {
  it("calls a band unknown when nothing has been logged in it", () => {
    expect(bandCoverage(band(0))).toBe("unknown");
  });

  it("calls a band partial below the covered threshold", () => {
    expect(bandCoverage(band(0, { dialed: BAND_COVERED_VERDICTS - 1 }))).toBe(
      "partial",
    );
  });

  it("calls a band covered at the threshold and above", () => {
    expect(bandCoverage(band(0, { dialed: BAND_COVERED_VERDICTS }))).toBe(
      "covered",
    );
    expect(bandCoverage(band(0, { cold: BAND_COVERED_VERDICTS + 4 }))).toBe(
      "covered",
    );
  });

  it("counts every verdict kind toward coverage", () => {
    // Being wrong about a band is data about it. A runner who was cold
    // twice and warm once knows more than one who logged nothing.
    expect(verdictsIn(band(0, { cold: 2, dialed: 0, warm: 1 }))).toBe(3);
    expect(bandCoverage(band(0, { cold: 2, warm: 1 }))).toBe("covered");
  });
});

describe("ladderFrom", () => {
  it("is guessing, and asks for nothing, on a brand new account", () => {
    const ladder = ladderFrom([]);

    expect(ladder.state).toBe("guessing");
    expect(ladder.verdictTotal).toBe(0);
    expect(ladder.verdictsUntilCall).toBe(CALL_VERDICT_THRESHOLD);
    // Nothing to reason from, so no band is suggested — the screen says
    // "logging now, calling later" rather than inventing a target.
    expect(ladder.thinnestBand).toBeUndefined();
  });

  it("is still guessing just below the learning line", () => {
    const ladder = ladderFrom([band(0, { dialed: 4 })]);

    expect(ladder.state).toBe("guessing");
    expect(ladder.verdictsUntilCall).toBe(CALL_VERDICT_THRESHOLD - 4);
  });

  it("is learning from five verdicts", () => {
    expect(ladderFrom([band(0, { dialed: 5 })]).state).toBe("learning");
  });

  it("is dialed at the threshold, and asks for nothing more", () => {
    const ladder = ladderFrom([band(0, { dialed: CALL_VERDICT_THRESHOLD })]);

    expect(ladder.state).toBe("dialed");
    expect(ladder.verdictsUntilCall).toBe(0);
  });

  it("never counts down past zero", () => {
    // "N verdicts until your first call" must not go negative on someone
    // who kept logging.
    const ladder = ladderFrom([band(0, { dialed: CALL_VERDICT_THRESHOLD + 9 })]);

    expect(ladder.verdictsUntilCall).toBe(0);
  });

  it("asks for the thinnest band, which is the gap inside their own range", () => {
    // O6's whole argument: this runner has plenty, but not in the cold.
    const ladder = ladderFrom([
      band(-5),
      band(0, { dialed: 2 }),
      band(5, { dialed: 20 }),
    ]);

    expect(ladder.thinnestBand?.bandFloorC).toBe(-5);
  });

  it("asks for a thin band that is not the first one", () => {
    // The case that separates "find the minimum" from "take the first":
    // every other example here happens to have its thinnest band first,
    // and a reducer that never compares would pass all of them.
    const ladder = ladderFrom([band(0, { dialed: 5 }), band(5)]);

    expect(ladder.thinnestBand?.bandFloorC).toBe(5);
  });

  it("breaks a tie toward the colder band", () => {
    // Underdressing is the failure that ends a run early.
    const ladder = ladderFrom([band(-5), band(10)]);

    expect(ladder.thinnestBand?.bandFloorC).toBe(-5);
  });

  it("totals across every band, not just the busiest", () => {
    const ladder = ladderFrom([
      band(0, { cold: 2 }),
      band(5, { dialed: 3 }),
      band(10, { warm: 1 }),
    ]);

    expect(ladder.verdictTotal).toBe(6);
    expect(ladder.state).toBe("learning");
  });

  it("colours every band it was given, gaps included", () => {
    const ladder = ladderFrom([
      band(0, { dialed: BAND_COVERED_VERDICTS }),
      band(5, { dialed: 1 }),
      band(10),
    ]);

    expect(ladder.bands.map((entry) => entry.coverage)).toStrictEqual([
      "covered",
      "partial",
      "unknown",
    ]);
  });
});
