/**
 * The `dialed-weather` cache: `(lat_r, lng_r, hour_bucket)` — 2dp rounding
 * (~1.1km) and hour-floor bucketing — is the whole budget story (docs/
 * tasks/103-weather.md): a cache hit never calls the provider, and two
 * points/times that round to the same key share one row.
 *
 * A `source='manual'` row can occupy a cache slot before real data exists
 * (lane 102's fallback UI, D-24). A later real fetch upgrades it in place;
 * a manual write never clobbers an existing real row — the upsert's
 * `setWhere` encodes both directions.
 */
import { and, eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/d1";

import { weatherObservations } from "../../db/schema-weather";
import { env } from "../../env";
import type { Ulid } from "../../lib/ids";
import { newUlid } from "../../lib/ids";
import type { WeatherObservation } from "../../lib/contracts";

export interface CacheKey {
  latR: number;
  lngR: number;
  hourBucket: number;
}

export type ObservationRow = typeof weatherObservations.$inferSelect;

export function roundCoord(value: number): number {
  return Math.round(value * 100) / 100;
}

export function hourBucketFor(at: Date): number {
  return Math.floor(at.getTime() / 3_600_000);
}

export function cacheKeyFor(lat: number, lng: number, at: Date): CacheKey {
  return {
    latR: roundCoord(lat),
    lngR: roundCoord(lng),
    hourBucket: hourBucketFor(at),
  };
}

function weatherDb() {
  return drizzle(env.DIALED_WEATHER);
}

/**
 * The cache-key predicate. Exported because `modules/feed` reads the same
 * table for its conditions strip and had grown its own copy of both this
 * and `cacheKeyFor` — two independent definitions of a key that has to
 * match exactly or every lookup silently returns nothing.
 */
export function matchesKey(key: CacheKey) {
  return and(
    eq(weatherObservations.latR, key.latR),
    eq(weatherObservations.lngR, key.lngR),
    eq(weatherObservations.hourBucket, key.hourBucket),
  );
}

export async function findObservationRow(
  key: CacheKey,
): Promise<ObservationRow | undefined> {
  const rows = await weatherDb()
    .select()
    .from(weatherObservations)
    .where(matchesKey(key))
    .limit(1);
  return rows[0];
}

/**
 * Write-through after a successful provider fetch. Upgrades a squatting
 * manual row in place; never clobbers an existing real row (a concurrent
 * fetch for the same cell already won). Returns the row now at that key —
 * always real once this resolves without throwing.
 */
/**
 * The upsert both writers share.
 *
 * `setWhere` is the load-bearing part: an existing row is only overwritten
 * when it is `source='manual'`, so a real observation never loses to a
 * later manual one and a manual one is always replaced by real data. It
 * was written out twice, and so was the conflict target — which is the
 * UNIQUE key restated a third time and the thing that silently stops
 * upserting if the index ever changes.
 */
async function upsertObservation(
  key: CacheKey,
  values: typeof weatherObservations.$inferInsert,
): Promise<ObservationRow> {
  await weatherDb()
    .insert(weatherObservations)
    .values(values)
    .onConflictDoUpdate({
      target: [
        weatherObservations.latR,
        weatherObservations.lngR,
        weatherObservations.hourBucket,
      ],
      set: {
        runId: values.runId,
        tempC: values.tempC,
        feelsLikeC: values.feelsLikeC,
        humidity: values.humidity,
        windKph: values.windKph,
        precipMm: values.precipMm,
        condition: values.condition,
        source: values.source,
        fetchedAt: values.fetchedAt,
      },
      setWhere: eq(weatherObservations.source, "manual"),
    });
  const row = await findObservationRow(key);
  // Unreachable, and deliberately kept: the insert either wrote the row or
  // conflicted with one already there, so the read that follows always
  // finds something. The guard exists to narrow `ObservationRow |
  // undefined` for the caller, and no test can enter it — which is why the
  // mutants on this line are suppressed rather than chased.
  // Stryker disable next-line all
  if (!row) throw new Error(`observation upsert produced no row at ${JSON.stringify(key)}`);
  return row;
}

export async function upsertRealObservation(
  key: CacheKey,
  observation: WeatherObservation,
  runId: Ulid | undefined,
): Promise<ObservationRow> {
  const fetchedAt = Math.floor(Date.now() / 1000);
  const values = {
    id: newUlid(),
    runId,
    latR: key.latR,
    lngR: key.lngR,
    hourBucket: key.hourBucket,
    tempC: observation.tempC,
    feelsLikeC: observation.feelsLikeC,
    humidity: observation.humidity,
    windKph: observation.windKph,
    precipMm: observation.precipMm,
    condition: observation.condition,
    source: "visualcrossing" as const,
    fetchedAt,
  };
  return upsertObservation(key, values);
}

/**
 * Manual fallback write (D-24). Never overwrites an already-real row — if
 * one exists at this key, the run should link to that instead (the caller
 * re-reads the row and reflects its actual source).
 */
export async function upsertManualObservation(
  key: CacheKey,
  tempC: number,
  runId: Ulid,
): Promise<ObservationRow> {
  const fetchedAt = Math.floor(Date.now() / 1000);
  const values = {
    id: newUlid(),
    runId,
    latR: key.latR,
    lngR: key.lngR,
    hourBucket: key.hourBucket,
    tempC,
    feelsLikeC: tempC,
    humidity: 0,
    windKph: 0,
    precipMm: 0,
    condition: "manual",
    source: "manual" as const,
    fetchedAt,
  };
  return upsertObservation(key, values);
}

export function toWeatherObservation(row: ObservationRow): WeatherObservation {
  return {
    tempC: row.tempC,
    feelsLikeC: row.feelsLikeC,
    humidity: row.humidity,
    windKph: row.windKph,
    precipMm: row.precipMm,
    condition: row.condition,
  };
}
