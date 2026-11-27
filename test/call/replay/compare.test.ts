import { describe, expect, it } from "vitest";

import {
  type Comparison,
  type MetricVerdict,
  noWorse,
  RELEASE_METRICS,
  type ReplayMetrics,
} from "../../../src/modules/call/replay";

function metrics(
  agreement: [number, number],
  direction: [number, number],
  cases = 10,
): ReplayMetrics {
  return {
    cases,
    dialedAgreement: { hits: agreement[0], of: agreement[1] },
    direction: { hits: direction[0], of: direction[1], noCall: 0 },
    coverage: { hits: cases, of: cases },
    byConfidence: [],
  };
}

function verdicts(comparison: Comparison): [MetricVerdict, MetricVerdict] {
  return [
    comparison.metrics.dialedAgreement.verdict,
    comparison.metrics.direction.verdict,
  ];
}

describe("noWorse", () => {
  const baseline = metrics([2, 4], [3, 4]);

  it("holds a release to dialed agreement and direction", () => {
    expect(RELEASE_METRICS).toEqual(["dialedAgreement", "direction"]);
  });

  it("passes an equal candidate", () => {
    expect(noWorse(baseline, metrics([1, 2], [3, 4]), 0)).toEqual({
      tolerance: 0,
      metrics: {
        dialedAgreement: {
          metric: "dialedAgreement",
          baseline: 0.5,
          candidate: 0.5,
          verdict: "equal",
        },
        direction: {
          metric: "direction",
          baseline: 0.75,
          candidate: 0.75,
          verdict: "equal",
        },
      },
      pass: true,
    });
  });

  it("passes a better candidate", () => {
    const comparison = noWorse(baseline, metrics([3, 4], [4, 4]), 0);
    expect(verdicts(comparison)).toEqual(["better", "better"]);
    expect(comparison.pass).toBe(true);
  });

  it("fails a candidate worse on one measure, even if better on the other", () => {
    const comparison = noWorse(baseline, metrics([4, 4], [2, 4]), 0);
    expect(verdicts(comparison)).toEqual(["better", "worse"]);
    expect(comparison.pass).toBe(false);
    const other = noWorse(baseline, metrics([1, 4], [4, 4]), 0);
    expect(verdicts(other)).toEqual(["worse", "better"]);
    expect(other.pass).toBe(false);
  });

  it("passes a drop of exactly the tolerance and fails one just past it", () => {
    const atTolerance = noWorse(baseline, metrics([1, 4], [2, 4]), 0.25);
    expect(verdicts(atTolerance)).toEqual([
      "within-tolerance",
      "within-tolerance",
    ]);
    expect(atTolerance.pass).toBe(true);
    const past = noWorse(baseline, metrics([1, 4], [3, 4]), 0.125);
    expect(verdicts(past)).toEqual(["worse", "equal"]);
    expect(past.pass).toBe(false);
    expect(
      noWorse(baseline, metrics([3, 8], [3, 4]), 0.125).metrics.dialedAgreement
        .verdict,
    ).toBe("within-tolerance");
  });

  it("fails when either side judged nothing", () => {
    const empty = metrics([0, 0], [0, 0], 0);
    const comparison = noWorse(empty, empty, 0);
    expect(comparison.metrics).toEqual({
      dialedAgreement: {
        metric: "dialedAgreement",
        baseline: undefined,
        candidate: undefined,
        verdict: "unmeasured",
      },
      direction: {
        metric: "direction",
        baseline: undefined,
        candidate: undefined,
        verdict: "unmeasured",
      },
    });
    expect(comparison.pass).toBe(false);
    expect(
      noWorse(baseline, metrics([0, 0], [3, 4]), 0).metrics.dialedAgreement
        .verdict,
    ).toBe("unmeasured");
    expect(
      noWorse(metrics([0, 0], [3, 4]), baseline, 0).metrics.dialedAgreement
        .verdict,
    ).toBe("unmeasured");
  });

  it("refuses to compare replays over different cases", () => {
    expect(() => noWorse(baseline, metrics([2, 4], [3, 4], 11), 0)).toThrow(
      new Error("replayed over different cases: 10 against 11"),
    );
  });

  it("refuses a negative tolerance and accepts zero", () => {
    expect(() => noWorse(baseline, baseline, -0.01)).toThrow(
      new RangeError("tolerance must not be negative: -0.01"),
    );
    expect(() => noWorse(baseline, baseline, -0.01)).toThrow(RangeError);
    expect(noWorse(baseline, baseline, 0).pass).toBe(true);
  });
});
