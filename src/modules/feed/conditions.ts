/**
 * Weather reads for the feed lane. SEAM: when lane 103 lands, these
 * cache-key reads swap to the weather module's index.ts conditions API —
 * the cache-key shape (lat/lng rounded to 2dp + hour bucket) is the frozen
 * contract in docs/contracts.md, not this file.
 *
 * dialed-core and dialed-weather are separate D1 databases, so there is no
 * SQL join: observations are resolved by unique-index seeks on
 * (lat_r, lng_r, hour_bucket), never by scanning dialed-weather.
 */
import { and, desc, eq, ne, or } from "drizzle-orm";
import { drizzle } from "drizzle-orm/d1";

import { weatherObservations } from "../../db/schema-weather";
import { env } from "../../env";

export type PrecipClass = "dry" | "damp" | "wet";

export interface Conditions {
  tempC: number;
  feelsLikeC: number;
  precipMm: number;
  condition: string;
  windKph: number;
  source: "visualcrossing" | "manual";
}

export function precipClassOf(precipMm: number): PrecipClass {
  if (precipMm <= 0.1) return "dry";
  if (precipMm <= 2.5) return "damp";
  return "wet";
}

/**
5 °C coverage bands: floor of the band containing feelsLikeC.
*/
export function bandFloorC(feelsLikeC: number): number {
  return Math.floor(feelsLikeC / 5) * 5;
}

function cToF(c: number): number {
  return Math.round((c * 9) / 5 + 32);
}

/**
"[38–46°]"-style band text in the user's unit (docs/product.md).
*/
export function bandLabel(bandFloor: number, unit: "f" | "c"): string {
  return unit === "c"
    ? `${String(bandFloor)}–${String(bandFloor + 5)}°`
    : `${String(cToF(bandFloor))}–${String(cToF(bandFloor + 5))}°`;
}

export function formatTemp(tempC: number, unit: "f" | "c"): string {
  return unit === "c"
    ? `${String(Math.round(tempC))}°`
    : `${String(cToF(tempC))}°`;
}

interface CacheKey {
  latR: number;
  lngR: number;
  hourBucket: number;
}

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

export function cacheKeyFor(
  lat: number,
  lng: number,
  epochSeconds: number,
): CacheKey {
  return {
    latR: round2(lat),
    lngR: round2(lng),
    hourBucket: Math.floor(epochSeconds / 3600),
  };
}

const CHUNK = 20;

interface Locatable {
  id: string;
  lat: number | null;
  lng: number | null;
  startedAt: number;
}

/**
 * Resolve observations for a batch of runs via cache-key index seeks.
 * Manual-source rows are kept here; callers that aggregate (consensus,
 * coverage) must exclude them — per-run display may show them.
 */
export async function observationsForRuns(
  batch: readonly Locatable[],
): Promise<Map<string, Conditions>> {
  const keyed = batch.flatMap((run) =>
    run.lat === null || run.lng === null
      ? []
      : [{ runId: run.id, key: cacheKeyFor(run.lat, run.lng, run.startedAt) }],
  );
  const db = drizzle(env.DIALED_WEATHER);
  const result = new Map<string, Conditions>();
  for (let index = 0; index < keyed.length; index += CHUNK) {
    const chunk = keyed.slice(index, index + CHUNK);
    const rows = await db
      .select()
      .from(weatherObservations)
      .where(
        or(
          ...chunk.map(({ key }) =>
            and(
              eq(weatherObservations.latR, key.latR),
              eq(weatherObservations.lngR, key.lngR),
              eq(weatherObservations.hourBucket, key.hourBucket),
            ),
          ),
        ),
      );
    for (const { runId, key } of chunk) {
      const row = rows.find(
        (r) =>
          r.latR === key.latR &&
          r.lngR === key.lngR &&
          r.hourBucket === key.hourBucket,
      );
      if (row) {
        result.set(runId, {
          tempC: row.tempC,
          feelsLikeC: row.feelsLikeC,
          precipMm: row.precipMm,
          condition: row.condition,
          windKph: row.windKph,
          source: row.source,
        });
      }
    }
  }
  return result;
}

/**
 * The viewer's current conditions from the shared cache: the freshest
 * non-manual observation at their rounded location within the last 3 hours.
 * Undefined degrades to the widened/empty consensus state (law 5) —
 * fetching a fresh observation is the weather lane's job.
 */
export async function currentConditions(
  lat: number,
  lng: number,
  nowEpochSeconds: number,
): Promise<Conditions | undefined> {
  const nowBucket = Math.floor(nowEpochSeconds / 3600);
  const buckets = [nowBucket, nowBucket - 1, nowBucket - 2];
  const atBucket = (bucket: number) =>
    and(
      eq(weatherObservations.latR, round2(lat)),
      eq(weatherObservations.lngR, round2(lng)),
      eq(weatherObservations.hourBucket, bucket),
    );
  const scope = and(
    ne(weatherObservations.source, "manual"),
    or(...buckets.map((bucket) => atBucket(bucket))),
  );
  const db = drizzle(env.DIALED_WEATHER);
  const [best] = await db
    .select()
    .from(weatherObservations)
    .where(scope)
    .orderBy(desc(weatherObservations.hourBucket))
    .limit(1);
  if (!best) return;
  return {
    tempC: best.tempC,
    feelsLikeC: best.feelsLikeC,
    precipMm: best.precipMm,
    condition: best.condition,
    windKph: best.windKph,
    source: best.source,
  };
}
