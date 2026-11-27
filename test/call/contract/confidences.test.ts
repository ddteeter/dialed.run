import { describe, expect, it } from "vitest";

import { CALL_VERDICT_THRESHOLD } from "../../../src/lib/contracts";
import { CONFIDENCES } from "../../../src/modules/call/contract";
import {
  CONFIDENT_RUNS_IN_BAND,
  confidenceOf,
} from "../../../src/modules/call/scorer/confidence";

describe("the contract's confidences", () => {
  it("lists every level, the least knowledge first", () => {
    expect(CONFIDENCES).toStrictEqual([
      "below-threshold",
      "best-guess",
      "borrowed",
      "probable",
      "confident",
    ]);
  });

  it("is the order the scorer's own ladder climbs in", () => {
    const known = { verdicts: CALL_VERDICT_THRESHOLD };
    const climbed = [
      confidenceOf({ verdicts: CALL_VERDICT_THRESHOLD - 1, runsInBand: 0 }),
      confidenceOf({ ...known, runsInBand: 0 }),
      confidenceOf({ ...known, runsInBand: 1 }),
      confidenceOf({ ...known, runsInBand: CONFIDENT_RUNS_IN_BAND }),
    ];

    expect(climbed).toStrictEqual([
      "below-threshold",
      "borrowed",
      "probable",
      "confident",
    ]);
    expect(climbed.map((level) => CONFIDENCES.indexOf(level))).toStrictEqual([
      0, 2, 3, 4,
    ]);
  });

  it("keeps the one level the scorer never answers, between none and borrowed", () => {
    expect(CONFIDENCES.indexOf("best-guess")).toBe(1);
  });
});
