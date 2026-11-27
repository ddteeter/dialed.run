import { CALL_VERDICT_THRESHOLD } from "../../../lib/contracts";
import type { Confidence } from "../contract";

/**
 * The runs in band at which a Call stops being `probable`: twice
 * `PERSONAL_PRIOR_STRENGTH`, the point where the runner's own runs
 * outweigh everything borrowed two to one. The board's "CONFIDENT · 11
 * RUNS IN BAND" is an example, not a rule (design sprint-a1, Q6).
 */
export const CONFIDENT_RUNS_IN_BAND = 6;

export interface ConfidenceInput {
  /**
   * Every verdict the runner has given, typed weather included: what the
   * teaser's ladder counts toward `CALL_VERDICT_THRESHOLD`, and what the
   * scorer counts too.
   */
  verdicts: number;
  /**
  The runs in the Call's band and class; absent with no forecast.
  */
  runsInBand: number | undefined;
}

/**
 * How much the Call knows here.
 *
 * With no forecast there is no band to be confident in or to borrow for,
 * so a runner over the threshold gets `probable` and no better.
 *
 * `best-guess` (O5: none of the runner's own) is never answered: the
 * threshold and the evidence count the same runs, so a runner over the
 * threshold always has some.
 */
export function confidenceOf(input: ConfidenceInput): Confidence {
  if (input.verdicts < CALL_VERDICT_THRESHOLD) return "below-threshold";
  if (input.runsInBand === undefined) return "probable";
  if (input.runsInBand === 0) return "borrowed";
  return input.runsInBand < CONFIDENT_RUNS_IN_BAND ? "probable" : "confident";
}
