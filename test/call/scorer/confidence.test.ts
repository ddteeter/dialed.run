import { describe, expect, it } from "vitest";

import { CALL_VERDICT_THRESHOLD } from "../../../src/lib/contracts";
import {
  CONFIDENT_RUNS_IN_BAND,
  confidenceOf,
} from "../../../src/modules/call/scorer/confidence";

const KNOWN = { verdicts: CALL_VERDICT_THRESHOLD };

describe("how much the Call knows (reading 6)", () => {
  it("puts the probable/confident cut at six runs in band", () => {
    expect(CONFIDENT_RUNS_IN_BAND).toBe(6);
  });

  it("is below the threshold one verdict short of it, whatever else is known", () => {
    expect(
      confidenceOf({
        verdicts: CALL_VERDICT_THRESHOLD - 1,
        runsInBand: 14,
      }),
    ).toBe("below-threshold");
  });

  it("is not below the threshold exactly at it", () => {
    expect(confidenceOf({ ...KNOWN, runsInBand: 12 })).toBe("confident");
  });

  it("is borrowed over the threshold with no runs in this band", () => {
    expect(confidenceOf({ ...KNOWN, runsInBand: 0 })).toBe("borrowed");
  });

  it("is probable from the first run in band to one short of the cut", () => {
    expect(confidenceOf({ ...KNOWN, runsInBand: 1 })).toBe("probable");
    expect(
      confidenceOf({ ...KNOWN, runsInBand: CONFIDENT_RUNS_IN_BAND - 1 }),
    ).toBe("probable");
  });

  it("is confident at the cut and past it", () => {
    expect(confidenceOf({ ...KNOWN, runsInBand: CONFIDENT_RUNS_IN_BAND })).toBe(
      "confident",
    );
    expect(
      confidenceOf({ ...KNOWN, runsInBand: CONFIDENT_RUNS_IN_BAND + 1 }),
    ).toBe("confident");
  });

  it("is probable, and no better, when the Call has no band", () => {
    expect(confidenceOf({ ...KNOWN, runsInBand: undefined })).toBe("probable");
  });
});
