/**
 * The release check, end to end (design 194, "Engine releases"): both
 * versions replayed over the same cases, measured, the candidate's reads
 * probed and held against its declaration, and the report. One function,
 * so the eval and a test run the same steps and no caller can leave the
 * probe out.
 */
import type { Scorer } from "../contract";
import type { ConditionRead, ReplayCase } from "./case";
import { noWorse, type Comparison } from "./compare";
import { measure } from "./metrics";
import { observedReads } from "./probe";
import { formatReport, type ReplayReport } from "./report";
import { replay, type ReplayOutcome } from "./run";

/**
 * A scorer version and the forecast fields it declares it reads.
 */
export interface DeclaredScorer {
  scorer: Scorer;
  reads: readonly ConditionRead[];
}

export interface ReleaseCheck {
  comparison: Comparison;
  report: ReplayReport;
}

/**
 * The version a column of the report is headed with: the one the scorer
 * stamped on its results, or the column's role when there are no results.
 */
function versionOf(outcomes: readonly ReplayOutcome[], role: string): string {
  return outcomes[0]?.result.engineVersion ?? role;
}

/**
 * Whether `candidate` may replace `baseline`, over these cases. Only the
 * candidate is probed: the baseline has already shipped.
 */
export function releaseCheck(
  baseline: Scorer,
  candidate: DeclaredScorer,
  cases: readonly ReplayCase[],
  tolerance: number,
): ReleaseCheck {
  const before = replay(baseline, cases);
  const after = replay(candidate.scorer, cases);
  const beforeMetrics = measure(before);
  const afterMetrics = measure(after);
  const comparison = noWorse(beforeMetrics, afterMetrics, {
    tolerance,
    reads: candidate.reads,
    observed: observedReads(candidate.scorer, cases),
  });
  const report = formatReport(
    { engineVersion: versionOf(before, "baseline"), metrics: beforeMetrics },
    { engineVersion: versionOf(after, "candidate"), metrics: afterMetrics },
    comparison,
  );
  return { comparison, report };
}
