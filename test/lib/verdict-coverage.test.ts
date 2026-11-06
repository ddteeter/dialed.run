import { describe, expect, it } from "vitest";

import {
  BAND_COVERED_VERDICTS,
  coverageOfVerdicts,
} from "../../src/lib/contracts";

/**
 * The one rule the profile ladder and Closet C's COVERAGE filter share
 * (R-94). Pinned against `BAND_COVERED_VERDICTS` rather than against 3 and
 * 1, so moving the threshold moves both readers and this test with them.
 */
describe("coverageOfVerdicts", () => {
  it("calls no verdicts unknown", () => {
    expect(coverageOfVerdicts(0)).toBe("unknown");
  });

  it("calls one verdict, and every count short of the threshold, partial", () => {
    expect(coverageOfVerdicts(1)).toBe("partial");
    expect(coverageOfVerdicts(BAND_COVERED_VERDICTS - 1)).toBe("partial");
  });

  it("calls the threshold and anything above it covered", () => {
    expect(coverageOfVerdicts(BAND_COVERED_VERDICTS)).toBe("covered");
    expect(coverageOfVerdicts(BAND_COVERED_VERDICTS + 1)).toBe("covered");
  });
});
