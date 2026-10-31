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
 * A `perf_daily` row, as much of it as the checks read.
 */
export interface PerfRow {
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
function isJudged(row: PerfRow): row is PerfRow & { metric: CheckedMetric } {
  return (
    isChecked(row.metric) &&
    (row.metric !== "server" || row.device === "2xx") &&
    row.n >= MIN_N
  );
}

function valueOf(row: PerfRow & { metric: CheckedMetric }): number {
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

function named(row: PerfRow & { metric: CheckedMetric }): string {
  return `${row.metric} ${SPEED_LIMITS[row.metric].stat} on ${row.route} (${row.device})`;
}

/**
 * Each of `day`'s judged rows over its fixed limit. At the limit is not
 * over it: the thresholds are "good up to and including".
 */
export function overLimit(rows: readonly PerfRow[], day: string): string[] {
  return rows
    .filter((row) => row.day === day)
    .filter((row) => isJudged(row))
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

const keyOf = (row: PerfRow): string =>
  `${row.route}\u{0}${row.metric}\u{0}${row.device}`;

/**
 * Each of `day`'s judged rows more than `MEDIAN_TOLERANCE` times the
 * median of the same route, metric and device over the days before it in
 * `rows` (the caller reads `BASELINE_DAYS` of them). Silent until
 * `MIN_BASELINE_DAYS` of those passed `MIN_N`.
 */
export function overMedian(rows: readonly PerfRow[], day: string): string[] {
  const baselines = new Map<string, number[]>();
  for (const row of rows) {
    if (row.day < day && isJudged(row)) {
      baselines.set(keyOf(row), [
        ...(baselines.get(keyOf(row)) ?? []),
        valueOf(row),
      ]);
    }
  }
  return rows
    .filter((row) => row.day === day)
    .filter((row) => isJudged(row))
    .flatMap((row) => {
      const baseline = baselines.get(keyOf(row)) ?? [];
      if (baseline.length < MIN_BASELINE_DAYS) return [];
      const usual = median(baseline);
      return valueOf(row) > usual * MEDIAN_TOLERANCE
        ? [
            `${named(row)} was ${shown(row.metric, valueOf(row))} on ${day}, more than ${String(Math.round((MEDIAN_TOLERANCE - 1) * 100))}% over its ${String(baseline.length)}-day median of ${shown(row.metric, usual)} (n=${String(row.n)})`,
          ]
        : [];
    });
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
