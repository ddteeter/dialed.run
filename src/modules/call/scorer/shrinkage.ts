import type { VerdictValue } from "../../../lib/contracts";
import { THERMAL_LEVEL_C, verdictScale } from "../../../lib/contracts";
import type { TempRange } from "../../../lib/contracts/thermal";
import { DIALED, type PieceRecord } from "./personal";

/**
 * The blend (design 194, "Engine": counting and shrinkage). A piece's
 * score is the chance its next run in these conditions is dialed, built
 * in three layers, each pulled toward the one before it:
 *
 * 1. the heuristic prior: the piece's estimate range against the hour's
 *    feel, shifted by the runner's thermal offset;
 * 2. the cohort: the dialed share of the cohort's runs in the piece's
 *    garment group, in this band and class;
 * 3. the runner's own runs in the piece, in this band and class.
 *
 * Each pull is the same shape: `(successes + anchor × strength) /
 * (trials + strength)`, a strength being how many runs of evidence the
 * anchor is worth. Every number below is a first proposal for the replay
 * harness to tune (design sprint-a1, open question 10).
 */

/**
The prior for a piece whose estimate range holds the feel.
*/
export const PRIOR_IN_RANGE = 0.7;

/**
The prior for a piece with no estimate, or a Call with no forecast.
*/
export const PRIOR_NO_ESTIMATE = 0.5;

/**
What the prior loses for each °C the feel sits outside the range.
*/
export const PRIOR_DROP_PER_C = 0.05;

/**
The least the prior says of any piece, however far outside its range.
*/
export const PRIOR_FLOOR = 0.1;

/**
The prior's strength against the cohort, in cohort verdicts.
*/
export const PRIOR_STRENGTH = 4;

/**
 * The most the cohort weighs, in verdicts. A cell says one thing about a
 * whole garment group, so past this it would wash out the only layer that
 * tells two pieces of one group apart before the runner has worn them.
 */
export const COHORT_STRENGTH_CAP = 8;

/**
The strength of everything borrowed against the runner's own runs.
*/
export const PERSONAL_PRIOR_STRENGTH = 3;

/**
 * The feel a runner's body reads the hour as. Positive thermal levels run
 * cold (`thermalScale`), so a level above zero makes the hour colder.
 *
 * Used against estimate ranges only. The runner's own runs already carry
 * how the hour felt to them and are never shifted (design sprint-a1, open
 * question 4).
 */
export function effectiveFeelC(feelsLikeC: number, thermalLevel = 0): number {
  return feelsLikeC - thermalLevel * THERMAL_LEVEL_C;
}

/**
 * How far a feel sits outside a range, in °C; zero inside it. An absent
 * end is open: nothing is too cold for a range with no low end.
 */
export function outsideByC(range: TempRange, feelC: number): number {
  const below = range.lowC === undefined ? 0 : range.lowC - feelC;
  const above = range.highC === undefined ? 0 : feelC - range.highC;
  return Math.max(below, above, 0);
}

/**
 * A piece's estimate and the feel to hold it against. Absent when the
 * piece has no estimate or the Call has no forecast.
 */
export interface EstimateAtFeel {
  range: TempRange;
  feelC: number;
}

/**
 * Layer 1: what the estimate tables say of a piece before anyone has run
 * in it.
 */
export function heuristicPrior(estimate: EstimateAtFeel | undefined): number {
  if (estimate === undefined) return PRIOR_NO_ESTIMATE;
  const outside = outsideByC(estimate.range, estimate.feelC);
  return Math.max(PRIOR_FLOOR, PRIOR_IN_RANGE - PRIOR_DROP_PER_C * outside);
}

/**
 * Layer 2: the prior pulled toward the cohort's dialed share for the
 * piece's group. With no cell it is the prior, and a cell with no verdicts
 * weighs nothing.
 */
export function cohortBase(
  prior: number,
  verdicts: Readonly<Record<VerdictValue, number>> | undefined,
): number {
  if (verdicts === undefined) return prior;
  let total = 0;
  for (const { value } of verdictScale) total += verdicts[value];
  const weight = Math.min(total, COHORT_STRENGTH_CAP);
  const dialed = verdicts[DIALED] * (weight / Math.max(total, 1));
  return (dialed + prior * PRIOR_STRENGTH) / (weight + PRIOR_STRENGTH);
}

/**
 * Layer 3: the base pulled toward the runner's own record in the piece.
 *
 * A flag is one more failed wear: a piece flagged on a dialed run counts
 * once for and once against, and one flagged on a run that was not dialed
 * counts twice against.
 */
export function shrunkScore(base: number, record: PieceRecord): number {
  return (
    (record.dialed + base * PERSONAL_PRIOR_STRENGTH) /
    (record.worn + record.flagged + PERSONAL_PRIOR_STRENGTH)
  );
}
