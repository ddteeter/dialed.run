import { describe, expect, it } from "vitest";

import { MIN_RUNNERS } from "../../../src/modules/feed/consensus/consensus";
import { COHORT_MIN_RUNNERS } from "../../../src/modules/call/scorer";
import { cellsAboveFloor } from "../../../src/modules/call/scorer/floor";
import { aCell } from "./builders";

describe("the cohort's privacy floor", () => {
  it("is the consensus block's floor (design 194's pin)", () => {
    expect(COHORT_MIN_RUNNERS).toBe(MIN_RUNNERS);
  });

  it("is five distinct runners", () => {
    expect(COHORT_MIN_RUNNERS).toBe(5);
  });

  it("drops a cell of four runners and keeps one of five or six", () => {
    const four = aCell({ bandRunners: 4 });
    const five = aCell({ bandRunners: 5 });
    const six = aCell({ bandRunners: 6 });

    expect(cellsAboveFloor([four, five, six])).toStrictEqual([five, six]);
  });

  it("drops a cell whose group four runners wore and keeps one of five or six (owner, 2026-11-26)", () => {
    const four = aCell({ bandRunners: 40, groupRunners: 4 });
    const five = aCell({ bandRunners: 40, groupRunners: 5 });
    const six = aCell({ bandRunners: 40, groupRunners: 6 });

    expect(cellsAboveFloor([four, five, six])).toStrictEqual([five, six]);
  });

  it("needs both: enough runners in the band and enough who wore the group", () => {
    const thinGroup = aCell({ bandRunners: 5, groupRunners: 4 });
    const thinBand = aCell({ bandRunners: 4, groupRunners: 5 });
    const both = aCell({ bandRunners: 5, groupRunners: 5 });

    expect(cellsAboveFloor([thinBand, thinGroup, both])).toStrictEqual([both]);
  });

  it("keeps nothing of no cells", () => {
    expect(cellsAboveFloor([])).toStrictEqual([]);
  });
});
