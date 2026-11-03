/**
 * The hourly speed checks (design 165), on the `:30` firing: whether the
 * newest deploy made a screen slower than the one before it, and whether
 * the last hours have drifted above what these hours usually are. Read
 * straight from the `VITALS` dataset through the SQL API, because the
 * daily rollup is a day too coarse for either.
 *
 * Unconfigured, both are silent: the daily digest already says so once a
 * day, and saying it 24 times more would only be noise.
 */
import {
  deployRegressions,
  drifts,
  DRIFT_WEEKS,
  type SpeedFinding,
  type WindowWeeks,
} from "./perf-checks";
import {
  answerSchema,
  measuredRowSchema,
  versionQuery,
  versionRowSchema,
  windowQuery,
} from "./vitals-queries";
import { rollupDepsFromEnv, type RollupDeps } from "./vitals-rollup";

const HOUR = 60 * 60;
const WEEK = 7 * 24 * HOUR;

/**
 * The drift check's window, in hours.
 */
export const WINDOW_HOURS = 3;

/**
 * How far back the deploy check reads: long enough to hold the deploy
 * before a quiet week's newest.
 */
export const VERSION_DAYS = 7;

export type SpeedQuery = NonNullable<RollupDeps["query"]>;

/**
 * The newest deploy against the one before it, while the newest has been
 * measured within the drift check's window: a deploy rolled back from
 * goes quiet, and is judged no more.
 */
export async function checkDeployRegressions(
  now: number,
  query: SpeedQuery,
): Promise<SpeedFinding[]> {
  const answer = answerSchema(versionRowSchema).parse(
    await query(versionQuery(now - VERSION_DAYS * 24 * HOUR)),
  );
  return deployRegressions(answer.data, now - WINDOW_HOURS * HOUR);
}

/**
 * One window, `hoursBack` whole hours before the current hour starts, for
 * this week and each of the `DRIFT_WEEKS` before it.
 */
async function windowWeeks(
  hour: number,
  hoursBack: number,
  query: SpeedQuery,
): Promise<WindowWeeks> {
  const start = hour - hoursBack * HOUR;
  return Promise.all(
    Array.from({ length: DRIFT_WEEKS + 1 }, async (_, weeksAgo) => {
      const from = start - weeksAgo * WEEK;
      const answer = answerSchema(measuredRowSchema).parse(
        await query(windowQuery(from, from + WINDOW_HOURS * HOUR)),
      );
      return answer.data;
    }),
  );
}

/**
 * The last three whole hours and the three before the last one, each
 * against the same hours of the past weeks.
 */
export async function checkDrift(
  now: number,
  query: SpeedQuery,
): Promise<SpeedFinding[]> {
  const hour = Math.floor(now / HOUR) * HOUR;
  const [current, previous] = await Promise.all([
    windowWeeks(hour, WINDOW_HOURS, query),
    windowWeeks(hour, WINDOW_HOURS + 1, query),
  ]);
  return drifts(current, previous);
}

/**
 * Both checks, each whichever of them fails, each finding handed to
 * `report`. A check that fails throws once the other has reported, so the
 * firing's check-in closes as an error.
 */
export interface HourlySpeedDeps {
  readonly query: RollupDeps["query"];
}

/**
 * The configured SQL API, or none.
 */
export function hourlySpeedDepsFromEnv(): HourlySpeedDeps {
  return { query: rollupDepsFromEnv().query };
}

export async function hourlySpeed(
  now: number,
  report: (finding: SpeedFinding) => void,
  deps: HourlySpeedDeps = hourlySpeedDepsFromEnv(),
): Promise<void> {
  const { query } = deps;
  if (query === undefined) return;
  const results = await Promise.allSettled([
    checkDeployRegressions(now, query),
    checkDrift(now, query),
  ]);
  for (const result of results) {
    if (result.status === "fulfilled") {
      for (const finding of result.value) report(finding);
    }
  }
  for (const result of results) {
    if (result.status === "rejected") throw result.reason;
  }
}
