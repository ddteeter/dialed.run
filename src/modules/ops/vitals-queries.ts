/**
 * The SQL that reads the `VITALS` dataset back (design 165), in one place:
 * the daily rollup's here, and the detector's and the Grafana dashboard's
 * join it, so a query and the layout it reads cannot drift apart
 * (`vitals.ts` writes the layout).
 *
 * Analytics Engine samples at volume, so every figure is weighted by
 * `_sample_interval`: a count is its sum, a percentile is
 * `quantileExactWeighted`. Its SQL API runs in `Etc/UTC`.
 */
import { z } from "zod";

/**
 * The dataset's name in `wrangler.jsonc`, which is the table's name in
 * SQL. `bindings-conformance` pins the binding to it.
 */
export const VITALS_DATASET = "dialed_vitals";

/**
 * A UTC day, `YYYY-MM-DD`. The only thing ever put into the SQL text, so
 * it is checked before it is: a query is a string, not a prepared
 * statement.
 */
const DAY = /^\d{4}-\d{2}-\d{2}$/u;

export class BadDayError extends Error {
  constructor(day: string) {
    super(`not a UTC day: ${JSON.stringify(day)}`);
    this.name = "BadDayError";
  }
}

/**
 * The day after `day`, `YYYY-MM-DD`.
 */
export function nextDay(day: string): string {
  if (!DAY.test(day)) throw new BadDayError(day);
  const next = new Date(`${day}T00:00:00Z`);
  next.setUTCDate(next.getUTCDate() + 1);
  return next.toISOString().slice(0, 10);
}

/**
 * The most rows the rollup reads for one day. Routes × metrics × devices
 * is under a thousand today; a day past this is not ours, and the cut is
 * safer than an unbounded read.
 */
export const MAX_ROLLUP_ROWS = 10_000;

/**
 * One day's p50, p75, p95 and weighted count per route, metric and
 * device. blob3 is the device for a browser metric and the status class
 * for a `server` point, which is why the rollup can store both in one
 * column.
 */
export function dailyRollupQuery(day: string): string {
  const end = nextDay(day);
  return [
    "SELECT index1 AS route, blob1 AS metric, blob3 AS device,",
    "quantileExactWeighted(0.5)(double1, _sample_interval) AS p50,",
    "quantileExactWeighted(0.75)(double1, _sample_interval) AS p75,",
    "quantileExactWeighted(0.95)(double1, _sample_interval) AS p95,",
    "sum(_sample_interval) AS n",
    `FROM ${VITALS_DATASET}`,
    `WHERE timestamp >= toDateTime('${day} 00:00:00', 'Etc/UTC')`,
    `AND timestamp < toDateTime('${end} 00:00:00', 'Etc/UTC')`,
    "GROUP BY index1, blob1, blob3",
    `LIMIT ${String(MAX_ROLLUP_ROWS)}`,
    "FORMAT JSON",
  ].join("\n");
}

/**
 * A number as the SQL API may send it. Its docs show values as strings
 * and do not say which types come back as numbers, so both are taken; a
 * string that is not a plain decimal is refused.
 */
const numeric = z
  .union([
    z.number(),
    z
      .string()
      .regex(/^-?\d+(?:\.\d+)?(?:e[+-]?\d+)?$/iu)
      .transform(Number),
  ])
  .pipe(z.number());

/**
 * One route, metric and device's figures, as every query here returns
 * them. A route is at most 96 characters, Analytics Engine's index limit.
 */
export const measuredRowSchema = z.object({
  route: z.string().min(1).max(96),
  metric: z.string().min(1).max(32),
  device: z.string().min(1).max(32),
  p75: numeric,
  p95: numeric,
  n: numeric.pipe(z.number().int().nonnegative()),
});

/**
 * The rollup's rows add the median.
 */
export const rollupRowSchema = measuredRowSchema.extend({ p50: numeric });

/**
 * The deploy-regression rows add the deploy and when it was first
 * measured, in unix seconds.
 */
export const versionRowSchema = measuredRowSchema.extend({
  version: z.string().min(1).max(64),
  firstSeen: numeric,
});

/**
 * The SQL API's JSON answer, as far as the rows: `{ meta, data, rows }`.
 */
export function answerSchema<TRow extends z.ZodType>(row: TRow) {
  return z.object({ data: z.array(row) });
}

/**
 * Unix seconds as the SQL API's `toDateTime` literal, `YYYY-MM-DD
 * hh:mm:ss`, UTC. From a number only, so nothing a person typed reaches
 * the SQL text.
 */
function sqlTime(seconds: number): string {
  return new Date(seconds * 1000).toISOString().slice(0, 19).replace("T", " ");
}

const since = (start: number): string =>
  `timestamp >= toDateTime('${sqlTime(start)}', 'Etc/UTC')`;

/**
 * p75, p95 and the weighted count per route, metric and device, between
 * two times (unix seconds, end excluded): one window of the drift check.
 */
export function windowQuery(start: number, end: number): string {
  return [
    "SELECT index1 AS route, blob1 AS metric, blob3 AS device,",
    "quantileExactWeighted(0.75)(double1, _sample_interval) AS p75,",
    "quantileExactWeighted(0.95)(double1, _sample_interval) AS p95,",
    "sum(_sample_interval) AS n",
    `FROM ${VITALS_DATASET}`,
    `WHERE ${since(start)}`,
    `AND timestamp < toDateTime('${sqlTime(end)}', 'Etc/UTC')`,
    "GROUP BY index1, blob1, blob3",
    `LIMIT ${String(MAX_ROLLUP_ROWS)}`,
    "FORMAT JSON",
  ].join("\n");
}

/**
 * The same figures per deploy (blob4) since `start`, with when each was
 * first measured: the deploy-regression check's input.
 */
export function versionQuery(start: number): string {
  return [
    "SELECT index1 AS route, blob1 AS metric, blob3 AS device, blob4 AS version,",
    "quantileExactWeighted(0.75)(double1, _sample_interval) AS p75,",
    "quantileExactWeighted(0.95)(double1, _sample_interval) AS p95,",
    "sum(_sample_interval) AS n,",
    "toUnixTimestamp(min(timestamp)) AS firstSeen",
    `FROM ${VITALS_DATASET}`,
    `WHERE ${since(start)}`,
    "GROUP BY index1, blob1, blob3, blob4",
    `LIMIT ${String(MAX_ROLLUP_ROWS)}`,
    "FORMAT JSON",
  ].join("\n");
}
