import type { CohortCell } from "../contract";

/**
 * The cohort's privacy floor (D-108; design 194, "Cohort data"): a cell
 * counted from fewer distinct runners than this is never read.
 *
 * The same number as the consensus block's `MIN_RUNNERS`, and a second
 * statement of it only because `feed` is being moved (design 261) and
 * nothing in `src` may import it meanwhile. `test/call/scorer/floor.test.ts`
 * pins the two together, so they cannot drift apart silently.
 */
export const COHORT_MIN_RUNNERS = 5;

/**
 * The cells the scorer may read: the ones counted from enough runners,
 * both in the band and class and among those who wore the group (owner,
 * 2026-11-26, #1103: D-108's "5+ distinct runners per figure"). A cell
 * short on either gives no figure at all: no dialed share, no share of
 * runners, no evidence fact.
 *
 * The producer of the cells should never send one below the floor, and
 * it leaves typed-weather runs out before it counts. The scorer drops a
 * thin cell anyway: the floor is a privacy rule, and a rule held in one
 * place fails the day that place has a bug.
 */
export function cellsAboveFloor(cells: readonly CohortCell[]): CohortCell[] {
  return cells.filter(
    (cell) =>
      cell.bandRunners >= COHORT_MIN_RUNNERS &&
      cell.groupRunners >= COHORT_MIN_RUNNERS,
  );
}
