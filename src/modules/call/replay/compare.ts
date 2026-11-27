/**
 * The release check (design 194, "Engine releases"): a candidate scorer
 * must not do worse than the version it replaces, over the same cases.
 */
import type { ConditionRead } from "./case";
import { rate, type ReplayMetrics } from "./metrics";

/**
 * The measures a release is held to, each on its own, at tolerance 0
 * (owner, 2026-11-26). Coverage gates so a scorer cannot "improve" by
 * declining the hard cases.
 */
export const RELEASE_METRICS = [
  "dialedAgreement",
  "direction",
  "coverage",
] as const;
export type ReleaseMetric = (typeof RELEASE_METRICS)[number];

/**
 * Which cases the check ran over. `v1-history` until the call log has
 * verdicts on served Calls; then `logged-calls` is the gate (owner,
 * 2026-11-26).
 */
export type ReplaySource = "v1-history" | "logged-calls" | "mixed";

export function sourceOf(metrics: ReplayMetrics): ReplaySource {
  if (metrics.rebuilt === metrics.cases) return "v1-history";
  return metrics.rebuilt === 0 ? "logged-calls" : "mixed";
}

/**
 * Reads a rebuilt case cannot serve: it carries the judged feel as its
 * temperature and no wind.
 */
const NOT_REBUILT: readonly ConditionRead[] = ["tempC", "windKph"];

export interface ReleaseOptions {
  /**
   * How far below the baseline a measure may fall and still pass, as a
   * fraction (0.01 is one percentage point).
   */
  tolerance: number;
  /**
   * The forecast fields the candidate scorer declares it reads. The wiring
   * PR supplies the scorer's declaration.
   */
  reads: readonly ConditionRead[];
}

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
  tolerance: number;
  source: ReplaySource;
  metrics: Readonly<Record<ReleaseMetric, MetricComparison>>;
  /**
   * Why the check fails whatever the measures say, or undefined.
   */
  blocked: string | undefined;
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
 * A scorer that reads what a rebuilt case does not carry is released only
 * over cases that do carry it.
 */
function blockedBy(
  source: ReplaySource,
  reads: readonly ConditionRead[],
): string | undefined {
  const unserved = NOT_REBUILT.filter((read) => reads.includes(read));
  return source !== "v1-history" || unserved.length === 0
    ? undefined
    : `the candidate reads ${unserved.join(" and ")}, which cases rebuilt from v1 history do not carry; replay it over logged Calls`;
}

/**
 * A candidate that improves one measure and regresses another fails: every
 * release measure must pass on its own.
 */
export function noWorse(
  baseline: ReplayMetrics,
  candidate: ReplayMetrics,
  { tolerance, reads }: ReleaseOptions,
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
    coverage: judge("coverage"),
  };
  const source = sourceOf(candidate);
  const blocked = blockedBy(source, reads);
  return {
    tolerance,
    source,
    metrics,
    blocked,
    pass:
      blocked === undefined &&
      RELEASE_METRICS.every((m) => PASSING.has(metrics[m].verdict)),
  };
}
