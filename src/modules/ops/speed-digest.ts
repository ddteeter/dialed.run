/**
 * The daily firing's `speed` digest kind (design 165): roll up the last
 * days of `VITALS` into `perf_daily`, then judge yesterday against its
 * limits and its own recent median. Handed to the digest by the Worker
 * entry (`DailyUpkeep.speed`), so a digest test fakes it rather than reach
 * the SQL API.
 */
import { and, gte, lte } from "drizzle-orm";
import type { DrizzleD1Database } from "drizzle-orm/d1";

import { perfDaily } from "../../db/schema-ops";
import { opsDb } from "../../env";
import {
  BASELINE_DAYS,
  overLimit,
  overMedian,
  runSpeedChecks,
} from "./perf-checks";
import {
  dayBefore,
  rollupDepsFromEnv,
  rollupVitals,
  type RollupDeps,
} from "./vitals-rollup";

export interface SpeedDigestDeps {
  readonly rollup: RollupDeps;
  readonly db: Pick<DrizzleD1Database, "select">;
}

/**
 * The real SQL API and ops database.
 */
export function speedDigestDepsFromEnv(): SpeedDigestDeps {
  return { rollup: rollupDepsFromEnv(), db: opsDb() };
}

export async function dailySpeed(
  today: string,
  anomalies: string[],
  deps: SpeedDigestDeps = speedDigestDepsFromEnv(),
): Promise<void> {
  await rollupVitals(today, anomalies, deps.rollup);
  const yesterday = dayBefore(today, 1);
  const since = gte(perfDaily.day, dayBefore(today, BASELINE_DAYS + 1));
  const rows = await deps.db
    .select()
    .from(perfDaily)
    .where(and(since, lte(perfDaily.day, yesterday)));
  runSpeedChecks(
    [() => overLimit(rows, yesterday), () => overMedian(rows, yesterday)],
    anomalies,
  );
}
