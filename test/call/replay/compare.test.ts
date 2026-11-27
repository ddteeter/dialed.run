import { describe, expect, it } from "vitest";

import {
  type Comparison,
  type ConditionRead,
  type MetricVerdict,
  noWorse,
  RELEASE_METRICS,
  type ReplayMetrics,
  sourceOf,
} from "../../../src/modules/call/replay";

interface Shape {
  agreement?: [number, number];
  direction?: [number, number];
  coverage?: [number, number];
  cases?: number;
  rebuilt?: number;
}

function metrics({
  agreement = [2, 4],
  direction = [3, 4],
  coverage = [8, 10],
  cases = 10,
  rebuilt = cases,
}: Shape = {}): ReplayMetrics {
  return {
    cases,
    rebuilt,
    dialedAgreement: { hits: agreement[0], of: agreement[1] },
    direction: { hits: direction[0], of: direction[1], noCall: 0 },
    coverage: { hits: coverage[0], of: coverage[1] },
    byConfidence: [],
  };
}

const strict = { tolerance: 0, reads: [], observed: [] };

function verdicts(comparison: Comparison): MetricVerdict[] {
  return RELEASE_METRICS.map((m) => comparison.metrics[m].verdict);
}

describe("noWorse", () => {
  const baseline = metrics();

  it("holds a release to all three measures", () => {
    expect(RELEASE_METRICS).toEqual([
      "dialedAgreement",
      "direction",
      "coverage",
    ]);
  });

  it("passes an equal candidate", () => {
    expect(noWorse(baseline, metrics({ agreement: [1, 2] }), strict)).toEqual({
      tolerance: 0,
      source: "v1-history",
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
        coverage: {
          metric: "coverage",
          baseline: 0.8,
          candidate: 0.8,
          verdict: "equal",
        },
      },
      blocked: undefined,
      pass: true,
    });
  });

  it("passes a better candidate", () => {
    const better = metrics({
      agreement: [3, 4],
      direction: [4, 4],
      coverage: [9, 10],
    });
    const comparison = noWorse(baseline, better, strict);
    expect(verdicts(comparison)).toEqual(["better", "better", "better"]);
    expect(comparison.pass).toBe(true);
  });

  it("fails a candidate worse on any one measure, even if better on the others", () => {
    const cases: [Shape, MetricVerdict[]][] = [
      [
        { agreement: [4, 4], direction: [2, 4], coverage: [9, 10] },
        ["better", "worse", "better"],
      ],
      [
        { agreement: [1, 4], direction: [4, 4], coverage: [9, 10] },
        ["worse", "better", "better"],
      ],
      [
        { agreement: [4, 4], direction: [4, 4], coverage: [7, 10] },
        ["better", "better", "worse"],
      ],
    ];
    for (const [shape, expected] of cases) {
      const comparison = noWorse(baseline, metrics(shape), strict);
      expect(verdicts(comparison)).toEqual(expected);
      expect(comparison.pass).toBe(false);
    }
  });

  it("passes a drop of exactly the tolerance and fails one just past it", () => {
    const at = noWorse(
      metrics({ agreement: [2, 4], direction: [3, 4], coverage: [10, 10] }),
      metrics({ agreement: [1, 4], direction: [2, 4], coverage: [7.5, 10] }),
      { tolerance: 0.25, reads: [], observed: [] },
    );
    expect(verdicts(at)).toEqual([
      "within-tolerance",
      "within-tolerance",
      "within-tolerance",
    ]);
    expect(at.pass).toBe(true);
    const past = noWorse(baseline, metrics({ agreement: [1, 4] }), {
      tolerance: 0.125,
      reads: [],
      observed: [],
    });
    expect(verdicts(past)).toEqual(["worse", "equal", "equal"]);
    expect(past.pass).toBe(false);
    const inside = noWorse(baseline, metrics({ agreement: [3, 8] }), {
      tolerance: 0.125,
      reads: [],
      observed: [],
    });
    expect(inside.metrics.dialedAgreement.verdict).toBe("within-tolerance");
  });

  it("fails when either side judged nothing", () => {
    const empty = metrics({
      agreement: [0, 0],
      direction: [0, 0],
      coverage: [0, 0],
      cases: 0,
    });
    const comparison = noWorse(empty, empty, strict);
    expect(verdicts(comparison)).toEqual([
      "unmeasured",
      "unmeasured",
      "unmeasured",
    ]);
    expect(comparison.metrics.coverage).toEqual({
      metric: "coverage",
      baseline: undefined,
      candidate: undefined,
      verdict: "unmeasured",
    });
    expect(comparison.pass).toBe(false);
    const unmeasured = metrics({ agreement: [0, 0] });
    expect(
      noWorse(baseline, unmeasured, strict).metrics.dialedAgreement.verdict,
    ).toBe("unmeasured");
    expect(
      noWorse(unmeasured, baseline, strict).metrics.dialedAgreement.verdict,
    ).toBe("unmeasured");
    expect(noWorse(unmeasured, baseline, strict).pass).toBe(false);
  });

  it("refuses to compare replays over different cases", () => {
    expect(() => noWorse(baseline, metrics({ cases: 11 }), strict)).toThrow(
      new Error("replayed over different cases: 10 against 11"),
    );
  });

  it("refuses a negative tolerance and accepts zero", () => {
    const negative = { tolerance: -0.01, reads: [], observed: [] };
    expect(() => noWorse(baseline, baseline, negative)).toThrow(
      new RangeError("tolerance must not be negative: -0.01"),
    );
    expect(() => noWorse(baseline, baseline, negative)).toThrow(RangeError);
    expect(noWorse(baseline, baseline, strict).pass).toBe(true);
  });
});

describe("the rebuilt-forecast guard", () => {
  const baseline = metrics();
  const reading = (reads: ConditionRead[]) =>
    noWorse(baseline, baseline, { tolerance: 0, reads, observed: [] });

  it("blocks a candidate that reads temperature or wind on rebuilt cases alone", () => {
    expect(reading(["tempC"])).toMatchObject({
      blocked:
        "the candidate reads tempC, which cases rebuilt from v1 history do not carry; replay it over logged Calls",
      pass: false,
    });
    expect(reading(["feelsLikeC", "windKph"]).blocked).toBe(
      "the candidate reads windKph, which cases rebuilt from v1 history do not carry; replay it over logged Calls",
    );
    expect(reading(["windKph", "tempC"]).blocked).toBe(
      "the candidate reads tempC and windKph, which cases rebuilt from v1 history do not carry; replay it over logged Calls",
    );
  });

  it("lets through a candidate that reads only the feel and precipitation", () => {
    expect(reading(["feelsLikeC", "precipMm"])).toMatchObject({
      blocked: undefined,
      pass: true,
    });
  });

  it("does not block when any case was logged as served", () => {
    for (const rebuilt of [0, 9]) {
      const comparison = noWorse(metrics({ rebuilt }), metrics({ rebuilt }), {
        tolerance: 0,
        reads: ["tempC", "windKph"],
        observed: [],
      });
      expect(comparison.blocked).toBeUndefined();
      expect(comparison.pass).toBe(true);
    }
  });

  it("judges the candidate's cases, not the baseline's", () => {
    const comparison = noWorse(metrics({ rebuilt: 0 }), baseline, {
      tolerance: 0,
      reads: ["tempC"],
      observed: [],
    });
    expect(comparison.source).toBe("v1-history");
    expect(comparison.pass).toBe(false);
  });
});

describe("the declared-reads check", () => {
  const baseline = metrics({ rebuilt: 0 });
  const check = (reads: ConditionRead[], observed: ConditionRead[]) =>
    noWorse(baseline, baseline, { tolerance: 0, reads, observed });

  it("blocks a candidate seen reading a field it did not declare", () => {
    expect(check([], ["tempC"])).toMatchObject({
      blocked: "the candidate reads fields it does not declare: tempC",
      pass: false,
    });
    expect(check(["tempC"], ["tempC", "windKph"]).blocked).toBe(
      "the candidate reads fields it does not declare: windKph",
    );
    expect(check([], ["feelsLikeC", "precipMm"]).blocked).toBe(
      "the candidate reads fields it does not declare: feelsLikeC, precipMm",
    );
  });

  it("passes a candidate that declares all it reads, and more", () => {
    expect(check(["feelsLikeC"], ["feelsLikeC"])).toMatchObject({
      blocked: undefined,
      pass: true,
    });
    expect(check(["feelsLikeC", "tempC"], ["feelsLikeC"]).pass).toBe(true);
    expect(check([], []).pass).toBe(true);
  });

  it("names an undeclared read before the rebuilt-forecast guard", () => {
    const rebuilt = metrics();
    expect(
      noWorse(rebuilt, rebuilt, {
        tolerance: 0,
        reads: ["windKph"],
        observed: ["tempC"],
      }).blocked,
    ).toBe("the candidate reads fields it does not declare: tempC");
  });
});

describe("sourceOf", () => {
  it("names v1 history, logged Calls, or a mix", () => {
    expect(sourceOf(metrics({ cases: 10, rebuilt: 10 }))).toBe("v1-history");
    expect(sourceOf(metrics({ cases: 10, rebuilt: 0 }))).toBe("logged-calls");
    expect(sourceOf(metrics({ cases: 10, rebuilt: 1 }))).toBe("mixed");
    expect(sourceOf(metrics({ cases: 10, rebuilt: 9 }))).toBe("mixed");
  });
});
