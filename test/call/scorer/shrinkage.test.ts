import { describe, expect, it } from "vitest";

import { THERMAL_LEVEL_C } from "../../../src/lib/contracts";
import {
  COHORT_STRENGTH_CAP,
  LEAN_PRIOR_STRENGTH,
  LEAN_STEP_C,
  PERSONAL_PRIOR_STRENGTH,
  PRIOR_DROP_PER_C,
  PRIOR_FLOOR,
  PRIOR_IN_RANGE,
  PRIOR_NO_ESTIMATE,
  PRIOR_STRENGTH,
  bandLeanC,
  cohortBase,
  effectiveFeelC,
  heuristicPrior,
  outsideByC,
  shrunkScore,
} from "../../../src/modules/call/scorer/shrinkage";
import { verdictCounts } from "./builders";

describe("the blend's constants (reading 10: a first proposal)", () => {
  it("are these, so a tuning is one visible change", () => {
    expect({
      PRIOR_IN_RANGE,
      PRIOR_NO_ESTIMATE,
      PRIOR_DROP_PER_C,
      PRIOR_FLOOR,
      PRIOR_STRENGTH,
      COHORT_STRENGTH_CAP,
      PERSONAL_PRIOR_STRENGTH,
      LEAN_PRIOR_STRENGTH,
      LEAN_STEP_C,
    }).toStrictEqual({
      PRIOR_IN_RANGE: 0.7,
      PRIOR_NO_ESTIMATE: 0.5,
      PRIOR_DROP_PER_C: 0.05,
      PRIOR_FLOOR: 0.1,
      PRIOR_STRENGTH: 4,
      COHORT_STRENGTH_CAP: 8,
      PERSONAL_PRIOR_STRENGTH: 3,
      LEAN_PRIOR_STRENGTH: 3,
      LEAN_STEP_C: THERMAL_LEVEL_C,
    });
  });
});

describe("the feel a runner reads the hour as (reading 4)", () => {
  it("is colder by one step for a runner who runs a little cold", () => {
    expect(effectiveFeelC(10, 1)).toBeCloseTo(10 - THERMAL_LEVEL_C, 10);
  });

  it("is warmer by two steps for a runner who runs hottest", () => {
    expect(effectiveFeelC(10, -2)).toBeCloseTo(10 + 2 * THERMAL_LEVEL_C, 10);
  });

  it("is the forecast's feel at level zero or with no level", () => {
    expect(effectiveFeelC(10, 0)).toBe(10);
    expect(effectiveFeelC(10)).toBe(10);
  });
});

describe("how a band's verdicts lean (owner, 2026-11-26)", () => {
  it("is nothing with no runs, or as many warm as cold", () => {
    expect(bandLeanC({ cold: 0, dialed: 0, warm: 0 })).toBe(0);
    expect(bandLeanC({ cold: 2, dialed: 5, warm: 2 })).toBe(0);
  });

  it("is warm minus cold over the runs plus three, in thermal steps", () => {
    expect(bandLeanC({ cold: 1, dialed: 2, warm: 4 })).toBeCloseTo(
      ((4 - 1) / (7 + 3)) * 2.2,
      10,
    );
  });

  it("is negative for a runner who ran cold more often than warm", () => {
    expect(bandLeanC({ cold: 5, dialed: 1, warm: 1 })).toBeCloseTo(
      ((1 - 5) / (7 + 3)) * 2.2,
      10,
    );
  });
});

describe("how far a feel sits outside an estimate range", () => {
  const range = { lowC: 4, highC: 12 };

  it("is nothing inside the range or at either end", () => {
    expect(outsideByC(range, 8)).toBe(0);
    expect(outsideByC(range, 4)).toBe(0);
    expect(outsideByC(range, 12)).toBe(0);
  });

  it("is the degrees below the low end", () => {
    expect(outsideByC(range, 1)).toBe(3);
  });

  it("is the degrees above the high end", () => {
    expect(outsideByC(range, 17)).toBe(5);
  });

  it("is never below an open low end", () => {
    expect(outsideByC({ highC: 12 }, -30)).toBe(0);
    expect(outsideByC({ highC: 12 }, 14)).toBe(2);
  });

  it("is never above an open high end", () => {
    expect(outsideByC({ lowC: 4 }, 40)).toBe(0);
    expect(outsideByC({ lowC: 4 }, 3)).toBe(1);
  });
});

describe("the heuristic prior", () => {
  const range = { lowC: 4, highC: 12 };

  it("is the no-estimate prior for a piece with nothing to hold up", () => {
    expect(heuristicPrior(undefined)).toBe(PRIOR_NO_ESTIMATE);
  });

  it("is the in-range prior when the range holds the feel", () => {
    expect(heuristicPrior({ range, feelC: 8 })).toBe(PRIOR_IN_RANGE);
  });

  it("drops by a fixed amount for each degree outside", () => {
    expect(heuristicPrior({ range, feelC: 15 })).toBeCloseTo(
      PRIOR_IN_RANGE - 3 * PRIOR_DROP_PER_C,
      10,
    );
    expect(heuristicPrior({ range, feelC: 0 })).toBeCloseTo(
      PRIOR_IN_RANGE - 4 * PRIOR_DROP_PER_C,
      10,
    );
  });

  it("stops at the floor, one degree short of it and well past it", () => {
    const degreesToFloor = (PRIOR_IN_RANGE - PRIOR_FLOOR) / PRIOR_DROP_PER_C;

    expect(
      heuristicPrior({ range, feelC: 12 + degreesToFloor - 1 }),
    ).toBeCloseTo(PRIOR_FLOOR + PRIOR_DROP_PER_C, 10);
    expect(heuristicPrior({ range, feelC: 12 + degreesToFloor + 1 })).toBe(
      PRIOR_FLOOR,
    );
    expect(heuristicPrior({ range, feelC: 60 })).toBe(PRIOR_FLOOR);
  });
});

describe("the cohort's pull on the prior", () => {
  it("leaves the prior alone when there is no cell", () => {
    expect(cohortBase(0.62, undefined)).toBeCloseTo(0.62, 10);
  });

  it("leaves the prior alone when the cell has no verdicts", () => {
    expect(cohortBase(0.62, verdictCounts())).toBeCloseTo(0.62, 10);
  });

  it("weighs a small cell by its verdicts, of every kind", () => {
    const verdicts = verdictCounts({ [-2]: 1, [-1]: 1, 0: 2, 1: 1, 2: 1 });

    expect(cohortBase(0.4, verdicts)).toBeCloseTo(
      (2 + 0.4 * PRIOR_STRENGTH) / (6 + PRIOR_STRENGTH),
      10,
    );
  });

  it("weighs a cell exactly at the cap in full", () => {
    const verdicts = verdictCounts({ 0: 6, 1: 2 });

    expect(cohortBase(0.4, verdicts)).toBeCloseTo(
      (6 + 0.4 * PRIOR_STRENGTH) / (COHORT_STRENGTH_CAP + PRIOR_STRENGTH),
      10,
    );
  });

  it("caps a large cell's weight and keeps its dialed share", () => {
    const verdicts = verdictCounts({ [-1]: 100, 0: 300 });

    expect(cohortBase(0.4, verdicts)).toBeCloseTo(
      (0.75 * COHORT_STRENGTH_CAP + 0.4 * PRIOR_STRENGTH) /
        (COHORT_STRENGTH_CAP + PRIOR_STRENGTH),
      10,
    );
  });
});

describe("the runner's own pull on the base", () => {
  it("leaves the base alone for a piece never worn", () => {
    expect(shrunkScore(0.62, { worn: 0, dialed: 0, flagged: 0 })).toBeCloseTo(
      0.62,
      10,
    );
  });

  it("pulls toward the piece's dialed share", () => {
    expect(shrunkScore(0.5, { worn: 9, dialed: 8, flagged: 0 })).toBeCloseTo(
      (8 + 0.5 * PERSONAL_PRIOR_STRENGTH) / (9 + PERSONAL_PRIOR_STRENGTH),
      10,
    );
  });

  it("counts each flag as one more failed wear", () => {
    expect(shrunkScore(0.5, { worn: 9, dialed: 8, flagged: 2 })).toBeCloseTo(
      (8 + 0.5 * PERSONAL_PRIOR_STRENGTH) / (11 + PERSONAL_PRIOR_STRENGTH),
      10,
    );
  });
});
