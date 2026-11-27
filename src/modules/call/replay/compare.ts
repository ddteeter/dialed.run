/**
 * The release check (design 194, "Engine releases"): a candidate scorer
 * must not do worse than the version it replaces, over the same cases.
 */
import { rate, type ReplayMetrics } from "./metrics";

/**
 * The measures a release is held to. Coverage is reported beside them but
 * does not gate, pending the owner's ruling (QUESTIONS.md).
 */
export const RELEASE_METRICS = ["dialedAgreement", "direction"] as const;
export type ReleaseMetric = (typeof RELEASE_METRICS)[number];

/**
 * `unmeasured` when either side judged no case: a release check over
 * nothing proves nothing, so it fails.
 */
export type MetricVerdict =
  "better" | "equal" | "within-tolerance" | "worse" | "unmeasured";

export interface MetricComparison {
  metric: ReleaseMetric;
  baseline: number | undefined;
  candidate: number | undefined;
  verdict: MetricVerdict;
}

export interface Comparison {
  /**
   * How far below the baseline a measure may fall and still pass, as a
   * fraction (0.01 is one percentage point).
   */
  tolerance: number;
  metrics: Readonly<Record<ReleaseMetric, MetricComparison>>;
  pass: boolean;
}

const PASSING: ReadonlySet<MetricVerdict> = new Set<MetricVerdict>([
  "better",
  "equal",
  "within-tolerance",
]);

function verdictOf(
  baseline: number | undefined,
  candidate: number | undefined,
  tolerance: number,
): MetricVerdict {
  if (baseline === undefined || candidate === undefined) return "unmeasured";
  if (candidate > baseline) return "better";
  if (candidate === baseline) return "equal";
  return candidate >= baseline - tolerance ? "within-tolerance" : "worse";
}

/**
 * A candidate that improves one measure and regresses another fails: every
 * release measure must pass on its own.
 */
export function noWorse(
  baseline: ReplayMetrics,
  candidate: ReplayMetrics,
  tolerance: number,
): Comparison {
  if (tolerance < 0) {
    throw new RangeError(
      `tolerance must not be negative: ${String(tolerance)}`,
    );
  }
  if (baseline.cases !== candidate.cases) {
    throw new Error(
      `replayed over different cases: ${String(baseline.cases)} against ${String(candidate.cases)}`,
    );
  }
  const judge = (metric: ReleaseMetric): MetricComparison => {
    const before = rate(baseline[metric]);
    const after = rate(candidate[metric]);
    return {
      metric,
      baseline: before,
      candidate: after,
      verdict: verdictOf(before, after, tolerance),
    };
  };
  const metrics = {
    dialedAgreement: judge("dialedAgreement"),
    direction: judge("direction"),
  };
  return {
    tolerance,
    metrics,
    pass: RELEASE_METRICS.every((m) => PASSING.has(metrics[m].verdict)),
  };
}
