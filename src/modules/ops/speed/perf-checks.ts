/**
 * The daily speed checks (design 165, detection): yesterday's figure per
 * route, metric and device, from `perf_daily`, against a fixed limit and
 * against its own recent median. Pure over the rows, so a test hands in
 * the rows a day would hold.
 *
 * **Silent below `MIN_N`.** A percentile over a handful of page views is
 * noise, and a forged slow value for a quiet route is the abuse the
 * public beacon allows; thirty samples is the floor for either to speak.
 *
 * The thresholds are starting values (design 165, open question 4), in
 * one block, to tune once real traffic exists.
 */

/**
 * One route, metric and device's figures over some span: a day in
 * `perf_daily`, a deploy, or a few hours.
 */
export interface Measured {
  readonly route: string;
  readonly metric: string;
  readonly device: string;
  readonly p75: number;
  readonly p95: number;
  readonly n: number;
}

/**
 * A `perf_daily` row, as much of it as the checks read.
 */
export interface PerfRow extends Measured {
  readonly day: string;
  readonly route: string;
  readonly metric: string;
  readonly device: string;
  readonly p75: number;
  readonly p95: number;
  readonly n: number;
}

export const MIN_N = 30;

/**
 * How much worse than its own median a day may be, as a ratio: 1.25 is
 * "more than 25% worse".
 */
export const MEDIAN_TOLERANCE = 1.25;

const TOLERANCE_PERCENT = String(Math.round((MEDIAN_TOLERANCE - 1) * 100));

/**
 * The days before yesterday whose median is the baseline, and how many of
 * them must have passed `MIN_N` for a median to mean anything.
 */
export const BASELINE_DAYS = 7;
export const MIN_BASELINE_DAYS = 3;

/**
 * What each checked metric is judged by: the percentile and its limit.
 * The browser's are Google's "good" thresholds at p75, where they are
 * defined; `nav` and the server's are ours. A server row is judged at p95
 * and only for `2xx` responses: a slow error is the error's problem, and
 * Sentry has it. FCP and TTFB are stored but not judged: LCP covers the
 * load, and they are there to explain it.
 */
export const SPEED_LIMITS = {
  LCP: { stat: "p75", limit: 2500 },
  INP: { stat: "p75", limit: 200 },
  CLS: { stat: "p75", limit: 0.1 },
  nav: { stat: "p75", limit: 1000 },
  server: { stat: "p95", limit: 1000 },
} as const satisfies Record<
  string,
  { readonly stat: "p75" | "p95"; readonly limit: number }
>;

type CheckedMetric = keyof typeof SPEED_LIMITS;

function isChecked(metric: string): metric is CheckedMetric {
  return Object.hasOwn(SPEED_LIMITS, metric);
}

/**
 * A row the checks may judge: a checked metric, a server row only if it
 * is `2xx`, and enough samples.
 */
function isJudged<TRow extends Measured>(
  row: TRow,
): row is TRow & { metric: CheckedMetric } {
  return (
    isChecked(row.metric) &&
    (row.metric !== "server" || row.device === "2xx") &&
    row.n >= MIN_N
  );
}

/**
 * The rows that pass `isKept` and may be judged.
 */
function judgedWhere<TRow extends Measured>(
  rows: readonly TRow[],
  isKept: (row: TRow) => boolean,
): (TRow & { metric: CheckedMetric })[] {
  return rows.filter((row) => isKept(row)).filter((row) => isJudged(row));
}

function valueOf(row: Measured & { metric: CheckedMetric }): number {
  return row[SPEED_LIMITS[row.metric].stat];
}

/**
 * A value as a person reads it: CLS is a score, everything else is
 * milliseconds.
 */
function shown(metric: CheckedMetric, value: number): string {
  return metric === "CLS"
    ? value.toFixed(3)
    : `${String(Math.round(value))} ms`;
}

function named(row: Measured & { metric: CheckedMetric }): string {
  return `${row.metric} ${SPEED_LIMITS[row.metric].stat} on ${row.route} (${row.device})`;
}

/**
 * Each of `day`'s judged rows over its fixed limit. At the limit is not
 * over it: the thresholds are "good up to and including".
 */
export function overLimit(rows: readonly PerfRow[], day: string): string[] {
  return judgedWhere(rows, (row) => row.day === day)
    .filter((row) => valueOf(row) > SPEED_LIMITS[row.metric].limit)
    .map(
      (row) =>
        `${named(row)} was ${shown(row.metric, valueOf(row))} on ${day}, over its ${shown(row.metric, SPEED_LIMITS[row.metric].limit)} limit (n=${String(row.n)})`,
    );
}

/**
 * The median of a non-empty list: the mean of its middle one or two.
 */
function median(values: readonly number[]): number {
  const sorted = values.toSorted((a, b) => a - b);
  const middle = sorted.slice(
    Math.floor((sorted.length - 1) / 2),
    Math.floor(sorted.length / 2) + 1,
  );
  return middle.reduce((sum, value) => sum + value, 0) / middle.length;
}

const keyOf = (row: Measured): string =>
  `${row.route}\u{0}${row.metric}\u{0}${row.device}`;

/**
 * Each of `rows` more than `MEDIAN_TOLERANCE` times slower than its
 * reference, with that reference and the figure it was compared with. A
 * row with no reference is skipped: there is nothing to be slower than.
 */
function slowerThan<TRow extends Measured & { metric: CheckedMetric }, TRef>(
  rows: readonly TRow[],
  referenceOf: (row: TRow) => TRef | undefined,
  usualOf: (reference: TRef) => number,
): { row: TRow; reference: TRef; usual: number }[] {
  const slower: { row: TRow; reference: TRef; usual: number }[] = [];
  for (const row of rows) {
    const reference = referenceOf(row);
    if (reference === undefined) continue;
    const usual = usualOf(reference);
    if (valueOf(row) > usual * MEDIAN_TOLERANCE) {
      slower.push({ row, reference, usual });
    }
  }
  return slower;
}

/**
 * Each of `day`'s judged rows more than `MEDIAN_TOLERANCE` times the
 * median of the same route, metric and device over the days before it in
 * `rows` (the caller reads `BASELINE_DAYS` of them). Silent until
 * `MIN_BASELINE_DAYS` of those passed `MIN_N`.
 */
export function overMedian(rows: readonly PerfRow[], day: string): string[] {
  const baselines = new Map<string, number[]>();
  const earlier = judgedWhere(rows, (row) => row.day < day);
  for (const row of earlier) {
    baselines.set(keyOf(row), [
      ...(baselines.get(keyOf(row)) ?? []),
      valueOf(row),
    ]);
  }
  const today = judgedWhere(rows, (row) => row.day === day);
  return slowerThan(
    today,
    (row) => {
      const baseline = baselines.get(keyOf(row));
      return baseline === undefined || baseline.length < MIN_BASELINE_DAYS
        ? undefined
        : baseline;
    },
    median,
  ).map(
    ({ row, reference: baseline, usual }) =>
      `${named(row)} was ${shown(row.metric, valueOf(row))} on ${day}, more than ${TOLERANCE_PERCENT}% over its ${String(baseline.length)}-day median of ${shown(row.metric, usual)} (n=${String(row.n)})`,
  );
}

/**
 * Runs each check on its own, so one that throws costs only itself: its
 * failure is a line, and the others still report (design 162's shape).
 */
export function runSpeedChecks(
  checks: readonly (() => string[])[],
  anomalies: string[],
): void {
  for (const check of checks) {
    try {
      anomalies.push(...check());
    } catch (error) {
      anomalies.push(`a speed check failed: ${String(error)}`);
    }
  }
}

/**
 * One hourly finding (design 165): which check, where, and the line a
 * person reads. Each is its own Sentry event, fingerprinted by check,
 * route, metric and day, so a regression is its own issue and alerts once
 * a day.
 */
export interface SpeedFinding {
  readonly check: "deploy-regression" | "drift";
  readonly route: string;
  readonly metric: string;
  readonly line: string;
}

/**
 * A route, metric and device's figures under one deploy, and when that
 * deploy was first and last measured (unix seconds).
 */
export interface VersionRow extends Measured {
  readonly version: string;
  readonly firstSeen: number;
  readonly lastSeen: number;
}

/**
 * The deploys measured, newest first, ordered by when each was first
 * measured.
 */
function versionsNewestFirst(rows: readonly VersionRow[]): string[] {
  const firstSeen = new Map<string, number>();
  for (const row of rows) {
    firstSeen.set(
      row.version,
      Math.min(firstSeen.get(row.version) ?? row.firstSeen, row.firstSeen),
    );
  }
  return [...firstSeen]
    .toSorted(([, a], [, b]) => b - a)
    .map(([version]) => version);
}

/**
 * Each route, metric and device the newest deploy made more than
 * `MEDIAN_TOLERANCE` times slower than the deploy before it, once both
 * have `MIN_N` samples. A first deploy has nothing to compare with, and is
 * silent.
 *
 * Only while the newest is still serving: measured at or after
 * `servingSince` (unix seconds). A rollback re-serves the older version
 * under its own id, so without this the deploy rolled back from would
 * stay "newest" and alert daily until it left the window.
 */
export function deployRegressions(
  rows: readonly VersionRow[],
  servingSince: number,
): SpeedFinding[] {
  // With one deploy `previous` is undefined, so no row is older and none
  // has anything to compare with; with none, `newest` is too, and nothing
  // is serving.
  const [newest, previous] = versionsNewestFirst(rows);
  const isServing = rows.some(
    (row) => row.version === newest && row.lastSeen >= servingSince,
  );
  if (!isServing) return [];
  const before = new Map<string, VersionRow & { metric: CheckedMetric }>();
  const older = judgedWhere(rows, (row) => row.version === previous);
  for (const row of older) {
    before.set(keyOf(row), row);
  }
  const newer = judgedWhere(rows, (row) => row.version === newest);
  return slowerThan(newer, (row) => before.get(keyOf(row)), valueOf).map(
    ({ row, reference: old }) => ({
      check: "deploy-regression",
      route: row.route,
      metric: row.metric,
      line: `${named(row)} is ${shown(row.metric, valueOf(row))} on deploy ${row.version}, more than ${TOLERANCE_PERCENT}% over ${shown(row.metric, valueOf(old))} on ${old.version} (n=${String(row.n)} and ${String(old.n)})`,
    }),
  );
}

/**
 * How far above its usual a window must be to count, as a multiple of the
 * baseline's median absolute deviation, and the least it must be above
 * the median whatever the MAD: four quiet weeks can have a MAD of zero,
 * and then any rise at all would count.
 */
export const DRIFT_MADS = 3;
export const DRIFT_FLOOR = 0.1;

/**
 * The weeks of history a window is compared with, and how many of them
 * must have passed `MIN_N`.
 */
export const DRIFT_WEEKS = 4;
export const MIN_DRIFT_WEEKS = 3;

/**
 * One window's rows for this week and each of the `DRIFT_WEEKS` before
 * it, the same hours of the same weekday: index 0 is this week.
 */
export type WindowWeeks = readonly (readonly Measured[])[];

interface Drifted {
  readonly row: Measured & { metric: CheckedMetric };
  readonly limit: number;
}

/**
 * The rows of this week's window above their usual: the median of the
 * same window in past weeks plus `DRIFT_MADS` deviations, or plus
 * `DRIFT_FLOOR` of the median if that is more.
 */
function driftedIn(weeks: WindowWeeks): Map<string, Drifted> {
  const now = weeks.slice(0, 1).flat();
  const past = weeks.slice(1).flat();
  const history = new Map<string, number[]>();
  for (const row of past) {
    if (isJudged(row)) {
      history.set(keyOf(row), [
        ...(history.get(keyOf(row)) ?? []),
        valueOf(row),
      ]);
    }
  }
  const drifted = new Map<string, Drifted>();
  for (const row of now) {
    const values = history.get(keyOf(row));
    if (
      values === undefined ||
      !isJudged(row) ||
      values.length < MIN_DRIFT_WEEKS
    ) {
      continue;
    }
    const usual = median(values);
    const spread = median(values.map((value) => Math.abs(value - usual)));
    const limit = usual + Math.max(DRIFT_MADS * spread, DRIFT_FLOOR * usual);
    if (valueOf(row) > limit) drifted.set(keyOf(row), { row, limit });
  }
  return drifted;
}

/**
 * Each route, metric and device above its usual in both of the last two
 * windows: the last three whole hours, and the three hours before the
 * last one. One noisy window is not drift; two in a row is.
 */
export function drifts(
  current: WindowWeeks,
  previous: WindowWeeks,
): SpeedFinding[] {
  const before = driftedIn(previous);
  const findings: SpeedFinding[] = [];
  for (const [key, { row, limit }] of driftedIn(current)) {
    if (!before.has(key)) continue;
    findings.push({
      check: "drift",
      route: row.route,
      metric: row.metric,
      line: `${named(row)} has been ${shown(row.metric, valueOf(row))} for the last three hours, above the ${shown(row.metric, limit)} usual for these hours (n=${String(row.n)})`,
    });
  }
  return findings;
}
