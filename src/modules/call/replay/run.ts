/**
 * Replaying a scorer: the same TypeScript the Worker runs, called once per
 * case. Pure, with no clock, so two runs over the same cases agree.
 */
import type { CallResult, Scorer } from "../contract";
import type { ReplayCase } from "./case";

export interface ReplayOutcome {
  replayCase: ReplayCase;
  result: CallResult;
}

export function replay(
  scorer: Scorer,
  cases: readonly ReplayCase[],
): ReplayOutcome[] {
  return cases.map((replayCase) => ({
    replayCase,
    result: scorer(replayCase.request),
  }));
}
