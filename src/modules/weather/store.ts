/**
 * The `dialed-weather` cache: `(lat_r, lng_r, hour_bucket)` — 2dp rounding
 * (~1.1km) and hour-floor bucketing — is the whole budget story (docs/
 * tasks/103-weather.md): a cache hit never calls the provider, and two
 * points/times that round to the same key share one row.
 *
 * **The cache holds real observations only** (review blocker B1). A band a
 * runner sets by hand (R2b, D-24) is theirs, for one run, and lives in
 * `manual_conditions` keyed by that run. Before that table existed the band
 * was written here, as a `source='manual'` row in the shared cell, where it
 * answered for every other runner there that hour. Those legacy rows are
 * still in the table: `findObservationRow` does not see them, and a real
 * fetch upgrades one in place (the upsert's `setWhere`).
 */
import { and, eq, inArray, ne } from "drizzle-orm";
import { drizzle } from "drizzle-orm/d1";

import { manualConditions, weatherObservations } from "../../db/schema-weather";
import { env } from "../../env";
import type { Ulid } from "../../lib/ids";
import { newUlid } from "../../lib/ids";
import type { WeatherObservation } from "../../lib/contracts";
import { readInChunks } from "../../lib/chunked";
import { isTimeZone } from "../../lib/dates";
import { nowSeconds } from "../../lib/now";

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

/**
 * The real observation at this cell, if one has been fetched. A legacy
 * manual row there is somebody's band, not the weather, so it reads as a
 * miss: the run asking fetches, and the write upgrades the row.
 */
export async function findObservationRow(
  key: CacheKey,
): Promise<ObservationRow | undefined> {
  const rows = await weatherDb()
    .select()
    .from(weatherObservations)
    .where(and(matchesKey(key), ne(weatherObservations.source, "manual")))
    .limit(1);
  return rows[0];
}

/**
 * Write-through after a successful provider fetch. Upgrades a legacy
 * manual row squatting the cell in place; never clobbers an existing real
 * row (a concurrent fetch for the same cell already won). Returns the row
 * now at that key — always real once this resolves without throwing.
 *
 * `setWhere` is the load-bearing part: an existing row is only overwritten
 * when it is `source='manual'`, so a real observation never loses and a
 * legacy band is always replaced by real data. The conflict target is the
 * UNIQUE key, and silently stops upserting if the index ever changes.
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
        timeZone: values.timeZone,
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
  // Block pair, not `next-line`: prettier wraps the throw onto its own
  // lines, so the StringLiteral and CallExpression mutants sit outside
  // what a single-line directive covers.
  // Stryker disable ConditionalExpression,BooleanLiteral,CallExpression,StringLiteral
  if (!row)
    throw new Error(
      `observation upsert produced no row at ${JSON.stringify(key)}`,
    );
  // Stryker restore ConditionalExpression,BooleanLiteral,CallExpression,StringLiteral
  return row;
}

export async function upsertRealObservation(
  key: CacheKey,
  observation: WeatherObservation,
  runId: Ulid | undefined,
): Promise<ObservationRow> {
  const fetchedAt = nowSeconds();
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
    // Absent when the fetch named none. The upsert below only ever
    // overwrites a *manual* row, and manual rows carry no zone, so there
    // is never a stale one to clear.
    timeZone: observation.timeZone,
    source: "visualcrossing" as const,
    fetchedAt,
  };
  return upsertObservation(key, values);
}

/**
 * A run's band (R2b, D-24), on the run and nowhere else. Upserted: a
 * retried save lands the same row, and a runner who picks again before the
 * status moved (the one write that can be retried here) gets their latest
 * pick.
 */
export async function upsertManualBand(
  runId: Ulid,
  tempC: number,
): Promise<void> {
  const stampedAt = nowSeconds();
  await weatherDb()
    .insert(manualConditions)
    .values({ runId, tempC, setAt: stampedAt })
    .onConflictDoUpdate({
      target: manualConditions.runId,
      set: { tempC, setAt: stampedAt },
    });
}

export type ManualBandRow = typeof manualConditions.$inferSelect;

/**
 * A band as a reading. Only the temperature was chosen; the rest are
 * neutral sentinels, because a band is excluded from every aggregate —
 * but `condition` is read straight onto the screen, and an empty string
 * there renders as a blank chip.
 */
export function bandObservation(band: ManualBandRow): WeatherObservation {
  return {
    tempC: band.tempC,
    feelsLikeC: band.tempC,
    humidity: 0,
    windKph: 0,
    precipMm: 0,
    condition: "manual",
  };
}

export function toWeatherObservation(row: ObservationRow): WeatherObservation {
  return {
    tempC: row.tempC,
    feelsLikeC: row.feelsLikeC,
    humidity: row.humidity,
    windKph: row.windKph,
    precipMm: row.precipMm,
    condition: row.condition,
    // Re-checked on the way out: the column is text, and a row can hold a
    // zone that was valid when written and is not in this runtime's ICU.
    ...(isTimeZone(row.timeZone) && { timeZone: row.timeZone }),
  };
}

/**
 * Every distinct hour-bucket cache key a run touches, starting with its
 * start hour.
 *
 * **The write and the read share this walk, and must.** `attach.ts` calls it
 * to decide which hours to resolve, and `feed/conditions.ts` calls it to
 * decide which to read back. A second copy of the rounding or the cap would
 * let the two disagree silently: the reader would look for an hour the
 * writer never fetched, or stop before an hour it did. Capped: a plausible long run is a handful of hours, and the
 * cap stops a bad duration turning one attach into hundreds of upstream
 * calls.
 */
const MAX_SAMPLED_HOURS = 6;

export function runHourKeys(
  lat: number,
  lng: number,
  startedAt: number,
  durationS: number,
): CacheKey[] {
  const spanned =
    Math.floor((startedAt + Math.max(durationS, 0)) / 3600) -
    Math.floor(startedAt / 3600);
  const hours = Math.min(spanned + 1, MAX_SAMPLED_HOURS);
  return Array.from({ length: hours }, (_unused, index) =>
    cacheKeyFor(lat, lng, new Date((startedAt + index * 3600) * 1000)),
  );
}

/**
 * Every band set for these runs, by run id. A primary-key read, in chunks
 * under D1's parameter cap.
 */
export async function manualBandsFor(
  runIds: readonly string[],
): Promise<ManualBandRow[]> {
  return readInChunks(runIds, (chunk) =>
    weatherDb()
      .select()
      .from(manualConditions)
      .where(inArray(manualConditions.runId, chunk)),
  );
}

export async function findManualBand(
  runId: Ulid,
): Promise<ManualBandRow | undefined> {
  const [band] = await manualBandsFor([runId]);
  return band;
}
