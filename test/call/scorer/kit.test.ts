import { describe, expect, it } from "vitest";

import type { GroupRecord } from "../../../src/modules/call/scorer/personal";
import { shouldWearGroup } from "../../../src/modules/call/scorer/kit";
import { aCell } from "./builders";

const NO_RUNS: GroupRecord = {
  withRuns: 0,
  withDialed: 0,
  withoutRuns: 0,
  withoutDialed: 0,
};
const mostWear = aCell({ group: "outer", bandRunners: 10, groupRunners: 6 });
const halfWear = aCell({ group: "outer", bandRunners: 10, groupRunners: 5 });

describe("which groups a kit fills (reading 7)", () => {
  it.each(["tops", "bottoms", "shoes"] as const)(
    "always takes a piece of %s, on no evidence at all",
    (group) => {
      expect(shouldWearGroup(group, NO_RUNS, undefined)).toBe(true);
    },
  );

  it.each(["outer", "hands_head", "socks_extras"] as const)(
    "takes no piece of %s on no evidence",
    (group) => {
      expect(shouldWearGroup(group, NO_RUNS, undefined)).toBe(false);
    },
  );

  it("takes one when the runner's runs with one were dialed more often", () => {
    const record = {
      withRuns: 4,
      withDialed: 3,
      withoutRuns: 6,
      withoutDialed: 4,
    };

    expect(shouldWearGroup("outer", record, undefined)).toBe(true);
  });

  it("takes none when wearing one only tied going without, whatever the cohort wears", () => {
    const record = {
      withRuns: 4,
      withDialed: 2,
      withoutRuns: 6,
      withoutDialed: 3,
    };

    expect(shouldWearGroup("outer", record, mostWear)).toBe(false);
  });

  it("takes none when going without was dialed more often", () => {
    const record = {
      withRuns: 4,
      withDialed: 2,
      withoutRuns: 6,
      withoutDialed: 4,
    };

    expect(shouldWearGroup("outer", record, mostWear)).toBe(false);
  });

  it("takes one the runner always wore here and mostly got right", () => {
    const record = { ...NO_RUNS, withRuns: 3, withDialed: 2 };

    expect(shouldWearGroup("outer", record, undefined)).toBe(true);
  });

  it("leaves it to the cohort when always wearing one was right only half the time", () => {
    const record = { ...NO_RUNS, withRuns: 2, withDialed: 1 };

    expect(shouldWearGroup("outer", record, undefined)).toBe(false);
    expect(shouldWearGroup("outer", record, halfWear)).toBe(false);
    expect(shouldWearGroup("outer", record, mostWear)).toBe(true);
  });

  it("takes none when the runner never wore one here and mostly got it right", () => {
    const record = { ...NO_RUNS, withoutRuns: 3, withoutDialed: 2 };

    expect(shouldWearGroup("outer", record, mostWear)).toBe(false);
  });

  it("leaves it to the cohort when never wearing one was right only half the time", () => {
    const record = { ...NO_RUNS, withoutRuns: 2, withoutDialed: 1 };

    expect(shouldWearGroup("outer", record, undefined)).toBe(false);
    expect(shouldWearGroup("outer", record, halfWear)).toBe(false);
    expect(shouldWearGroup("outer", record, mostWear)).toBe(true);
  });

  it("follows the cohort for a runner with no runs here: most of it, not half", () => {
    expect(shouldWearGroup("outer", NO_RUNS, mostWear)).toBe(true);
    expect(shouldWearGroup("outer", NO_RUNS, halfWear)).toBe(false);
  });
});
