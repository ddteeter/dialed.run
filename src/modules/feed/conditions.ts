/**
 * Weather reads for the feed lane. SEAM: when lane 103 lands, these
 * cache-key reads swap to the weather module's index.ts conditions API —
 * the cache-key shape (lat/lng rounded to 2dp + hour bucket) is the frozen
 * contract in docs/contracts.md, not this file.
 *
 * dialed-core and dialed-weather are separate D1 databases, so there is no
 * SQL join: observations are resolved by unique-index seeks on
 * (lat_r, lng_r, hour_bucket), never by scanning dialed-weather.
 *
 * Pure classification/formatting helpers (precipClassOf, bandFloorC,
 * bandLabel, formatTemp) live in lib/temperature.ts, not here — this file
 * imports `env`, and a route component that value-imports anything from an
 * env-touching file breaks the client build (Vite/Rolldown must resolve
 * `cloudflare:workers` even for bindings the component never uses).
 */
import { and, desc, eq, ne, or } from "drizzle-orm";
import { drizzle } from "drizzle-orm/d1";

import { weatherObservations } from "../../db/schema-weather";
import { env } from "../../env";

export interface Conditions {
  tempC: number;
  feelsLikeC: number;
  precipMm: number;
  condition: string;
  windKph: number;
  source: "visualcrossing" | "manual";
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
 * How many hour-buckets back "now" is allowed to reach.
 *
 * Was 3 (up to three hours stale), which is long enough for a front to come
 * through: the consensus surface would show kit chosen for conditions that
 * no longer existed, and do it silently, because a stale reading looks
 * exactly like a fresh one on screen.
 *
 * 2 is the closest expressible thing to the 60 minutes we actually want.
 * Observations are keyed by whole hour, so a bucket describes an hour, not
 * an instant: the current bucket plus one gives "this hour or last hour",
 * which is ~0-60 minutes stale in the common case and up to ~120 at the
 * pathological edge. Reaching only the current bucket would be tighter but
 * returns nothing at all for the first minutes after the hour turns.
 *
 * Tightening this to a true 30 or 60 minutes needs sub-hour buckets, which
 * is a weather-lane change to the cache key, not a constant here.
 */
const FRESH_BUCKETS = 2;

/**
 * The viewer's current conditions from the shared cache: the freshest
 * non-manual observation at their rounded location, within
 * FRESH_BUCKETS hour-buckets. Undefined degrades to the widened/empty
 * consensus state (law 5) — fetching a fresh observation is the weather
 * lane's job.
 */
export async function currentConditions(
  lat: number,
  lng: number,
  nowEpochSeconds: number,
): Promise<Conditions | undefined> {
  const nowBucket = Math.floor(nowEpochSeconds / 3600);
  const buckets = Array.from(
    { length: FRESH_BUCKETS },
    (_unused, index) => nowBucket - index,
  );
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
