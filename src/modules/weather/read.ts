/**
 * Conditions read API for lane 104 (docs/tasks/104-feed-social.md: entry
 * detail + the consensus block). `modules/weather` is the only module that
 * touches `dialed-weather` (docs/architecture.md), so any other module
 * needs a read path through here.
 */
import { and, eq, ne, or } from "drizzle-orm";
import { drizzle } from "drizzle-orm/d1";

import { runs } from "../../db/schema-core";
import { weatherObservations } from "../../db/schema-weather";
import { env } from "../../env";
import type { WeatherObservation } from "../../lib/contracts";
import type { Ulid } from "../../lib/ids";
import { cacheKeyFor, toWeatherObservation } from "./store";

/** A resolved observation plus whether it came from a real fetch or a
 * user-typed fallback — 104 shows manual readings differently. */
export type WeatherReading = WeatherObservation & {
  source: "visualcrossing" | "manual";
};

function keyString(latR: number, lngR: number, hourBucket: number): string {
  return `${String(latR)}|${String(lngR)}|${String(hourBucket)}`;
}

/**
 * Run-detail read: whatever is cached at this run's key, manual included.
 */
export async function observationForRun(
  runId: Ulid,
): Promise<WeatherReading | undefined> {
  const [run] = await drizzle(env.DIALED_CORE)
    .select()
    .from(runs)
    .where(eq(runs.id, runId))
    .limit(1);
  if (!run) {
    return undefined;
  }
  if (run.lat === null || run.lng === null) {
    return undefined;
  }
  const key = cacheKeyFor(run.lat, run.lng, new Date(run.startedAt * 1000));
  const [row] = await drizzle(env.DIALED_WEATHER)
    .select()
    .from(weatherObservations)
    .where(
      and(
        eq(weatherObservations.latR, key.latR),
        eq(weatherObservations.lngR, key.lngR),
        eq(weatherObservations.hourBucket, key.hourBucket),
      ),
    )
    .limit(1);
  if (!row) {
    return undefined;
  }
  return { ...toWeatherObservation(row), source: row.source };
}

/**
 * Consensus batch read (104's "your conditions" block): manual rows are
 * excluded from every aggregate the module exposes (contracts.md). Bounded
 * by the caller's own scan window (104's packet requires the EXPLAIN +
 * row-scan cap on its side); this only matches the exact cache cells the
 * given runs land in.
 */
export async function observationsForRuns(
  runIds: Ulid[],
): Promise<Map<Ulid, WeatherObservation>> {
  const result = new Map<Ulid, WeatherObservation>();
  if (runIds.length === 0) {
    return result;
  }

  const runRows = await drizzle(env.DIALED_CORE)
    .select({ id: runs.id, lat: runs.lat, lng: runs.lng, startedAt: runs.startedAt })
    .from(runs)
    .where(or(...runIds.map((id) => eq(runs.id, id))));

  const keyedRuns = runRows.filter(
    (r): r is typeof r & { lat: number; lng: number } =>
      r.lat !== null && r.lng !== null,
  );
  if (keyedRuns.length === 0) {
    return result;
  }

  const keyed = keyedRuns.map((r) => ({
    runId: r.id as Ulid,
    key: cacheKeyFor(r.lat, r.lng, new Date(r.startedAt * 1000)),
  }));

  const cellConditions = keyed.map(({ key }) =>
    and(
      eq(weatherObservations.latR, key.latR),
      eq(weatherObservations.lngR, key.lngR),
      eq(weatherObservations.hourBucket, key.hourBucket),
    ),
  );

  const rows = await drizzle(env.DIALED_WEATHER)
    .select()
    .from(weatherObservations)
    .where(and(or(...cellConditions), ne(weatherObservations.source, "manual")));

  const bySourceKey = new Map(
    rows.map((row) => [keyString(row.latR, row.lngR, row.hourBucket), row]),
  );

  for (const { runId, key } of keyed) {
    const row = bySourceKey.get(keyString(key.latR, key.lngR, key.hourBucket));
    if (row) {
      result.set(runId, toWeatherObservation(row));
    }
  }
  return result;
}
