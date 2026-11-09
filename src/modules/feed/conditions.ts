/**
 * Conditions for the feed lane, assembled from the weather module's cache
 * reads (design 173). Only `modules/weather` touches `dialed-weather`
 * (docs/architecture.md); this file decides which cells a run touched and
 * what its conditions are, and asks weather for the rows. The cache-key
 * shape (lat/lng rounded to 2dp + hour bucket) is the frozen contract in
 * docs/contracts.md, not this file.
 *
 * dialed-core and dialed-weather are separate D1 databases, so there is no
 * SQL join: observations are resolved by unique-index seeks on
 * (lat_r, lng_r, hour_bucket), never by scanning dialed-weather.
 *
 * Pure classification/formatting helpers (precipClassOf, bandFloorC,
 * bandLabel, formatTemp) live in lib/contracts/temperature.ts, not here — this file
 * reaches `env` through the weather barrel, and a route component that
 * value-imports anything from an env-touching file breaks the client build
 * (Vite/Rolldown must resolve `cloudflare:workers` even for bindings the
 * component never uses).
 */
import { inArray } from "drizzle-orm";
import type { DrizzleD1Database } from "drizzle-orm/d1";

import { runs } from "../../db/schema-core";
import { readInChunks } from "../../lib/chunked";
import { pointSpan } from "../../lib/contracts";
import type { Conditions } from "../../lib/contracts";
import {
  cacheKeyFor,
  conditionsForRuns,
  newestObservationAt,
  zoneField,
} from "../weather";

/** The core D1 handle. Callers hold their own — consensus takes one as
 * an argument so the cron can pass a non-request binding. */
type CoreDb = DrizzleD1Database;

export { pointSpan } from "../../lib/contracts";
export type { Conditions, ConditionsSpan } from "../../lib/contracts";

/**
 * A batch of runs' conditions, by run id. The derivation is the weather
 * module's (`weather/run-conditions.ts`, design 189), which also writes the
 * copy the consensus reads; the feed keeps its old name for it.
 */
export const observationsForRuns = conditionsForRuns;

/**
 * Resolve observations for a set of entries, by way of their runs.
 *
 * The two steps exist because `DIALED_CORE` and `DIALED_WEATHER` are
 * separate databases and D1 cannot join across them (CLAUDE.md law 8c), so
 * the entry -> run -> observation walk is assembled in code. Three call
 * sites had it copy-pasted — consensus, the verdict band counts, and the
 * item wear stat — which is three chances to forget that `lat`/`lng` can be
 * null or that the run select needs `startedAt` for the cache key.
 */
export async function observationsForEntries(
  database: CoreDb,
  entries: readonly { runId: string }[],
): Promise<Map<string, Conditions>> {
  // In chunks: the list can be a whole consensus window of entries, and
  // D1 refuses more than 100 bound parameters in one statement.
  const rows = await readInChunks(
    entries.map((entry) => entry.runId),
    (runIds) =>
      database
        .select({
          id: runs.id,
          lat: runs.lat,
          lng: runs.lng,
          startedAt: runs.startedAt,
          durationS: runs.durationS,
        })
        .from(runs)
        .where(inArray(runs.id, runIds)),
  );
  return conditionsForRuns(rows);
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
 * observation at their rounded location, within
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
  const here = cacheKeyFor(lat, lng, new Date());
  const best = await newestObservationAt(
    buckets.map((bucket) => ({ ...here, hourBucket: bucket })),
  );
  if (!best) return;
  return {
    tempC: best.tempC,
    feelsLikeC: best.feelsLikeC,
    precipMm: best.precipMm,
    condition: best.condition,
    windKph: best.windKph,
    source: best.source,
    ...zoneField(best.timeZone),
    // A live reading is one hour by construction — this answers "what is
    // it like there now", not "what was a run like". The span is that one
    // hour, so a viewer's conditions compare against a runner's the same
    // way whichever side they are on.
    span: pointSpan(best.tempC, best.feelsLikeC),
  };
}

/**
 * The viewer's current conditions when both coordinates are known, and
 * nothing when either is not.
 *
 * The picker asks for a location it may not have — a browser can refuse
 * geolocation — and shows the whole closet when it gets nothing back.
 * That decision lives here rather than in `functions.ts`, which no test
 * can import (R-41).
 */
export async function conditionsAt(
  lat: number | undefined,
  lng: number | undefined,
  nowEpochSeconds: number,
): Promise<Conditions | undefined> {
  // Equivalent mutant, and worth writing down why:
  // `roundCoordinate(undefined)` is `NaN`, not 0, so a half-located lookup
  // keys to a cell nothing can match and answers undefined anyway. The guard says the intent — "we do
  // not know where you are" — and saves the query.
  // Stryker disable next-line ConditionalExpression,LogicalOperator
  return lat === undefined || lng === undefined
    ? undefined
    : currentConditions(lat, lng, nowEpochSeconds);
}
