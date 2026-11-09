/**
 * Weather's half of `run_conditions` (D-175, design 189): the copy of a
 * run's conditions the consensus reads in core, written in the same batch
 * that settles the run, so the run's status and the copy are one fact.
 *
 * Feed writes the other half (the entry's verdict, time and audience);
 * each half is written only by the module that owns the fact it copies.
 */
import { eq, sql } from "drizzle-orm";
import type { DrizzleD1Database } from "drizzle-orm/d1";

import { runConditions, runs } from "../../db/schema-core";
import type { Conditions } from "../../lib/contracts";
import { precipClassOf } from "../../lib/contracts/temperature";
import { inJsonList } from "../../lib/sql/json-list";
import { conditionsForRuns } from "./run-conditions";

type CoreDb = DrizzleD1Database<Record<string, unknown>>;

/**
The weather half's columns, as a run's conditions give them.
*/
export function weatherHalfOf(conditions: Conditions) {
  return {
    feelsLikeC: conditions.feelsLikeC,
    minFeelsLikeC: conditions.span.minFeelsLikeC,
    maxFeelsLikeC: conditions.span.maxFeelsLikeC,
    precipClass: precipClassOf(conditions.precipMm),
    source: conditions.source,
  };
}

// SQL NULL, the value a column with no conditions holds: `undefined`
// would leave the old half in place on an upsert's update.
const NO_WEATHER = {
  feelsLikeC: sql`NULL`,
  minFeelsLikeC: sql`NULL`,
  maxFeelsLikeC: sql`NULL`,
  precipClass: sql`NULL`,
  source: sql`NULL`,
};

/**
 * The statement that writes a run's weather half, or clears it when the
 * run has no conditions to copy. An upsert on the run id, touching only
 * this half, so it is the same row whether feed wrote first or not, and
 * writing it twice is writing it once (law 1). A read, then a statement
 * for the caller's batch: a batch cannot branch on its own reads.
 *
 * In a list, never bare: a drizzle builder is thenable, so an async
 * function returning one would run it when its promise resolved, and hand
 * back the result instead of the statement. The list is empty when the
 * run is gone.
 */
export async function weatherHalfStatements(db: CoreDb, runId: string) {
  const [run] = await db
    .select({
      id: runs.id,
      userId: runs.userId,
      lat: runs.lat,
      lng: runs.lng,
      startedAt: runs.startedAt,
      durationS: runs.durationS,
    })
    .from(runs)
    .where(eq(runs.id, runId))
    .limit(1);
  if (run === undefined) return [];
  const derived = await conditionsForRuns([run]);
  const conditions = derived.get(run.id);
  const half =
    conditions === undefined ? NO_WEATHER : weatherHalfOf(conditions);
  return [
    db
      .insert(runConditions)
      .values({ runId: run.id, userId: run.userId, ...half })
      .onConflictDoUpdate({ target: runConditions.runId, set: half }),
  ];
}

/**
 * Clears the weather half of runs whose conditions are owed again
 * (`pending`): the hourly retry cron's repair (law 8c, reconciliation).
 * A run is set back to `pending` by a retime, a refetch or the Desk's
 * Retry, and settling it again writes a fresh half; until then the old
 * one must not count.
 */
export function clearWeatherHalves(db: CoreDb, runIds: readonly string[]) {
  return db
    .update(runConditions)
    .set(NO_WEATHER)
    .where(inJsonList(runConditions.runId, runIds));
}
