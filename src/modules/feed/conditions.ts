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
import { and, desc, inArray, ne, or } from "drizzle-orm";
import { drizzle } from "drizzle-orm/d1";
import type { DrizzleD1Database } from "drizzle-orm/d1";

import { runs } from "../../db/schema-core";
import { weatherObservations } from "../../db/schema-weather";
import { chunked } from "../../lib/chunked";
import { pointSpan } from "./conditions-shape";
import type { Conditions } from "./conditions-shape";

type ObservationRow = typeof weatherObservations.$inferSelect;
import { env } from "../../env";
// The cache key and its predicate come from the module that owns the table
// (docs/architecture.md: only modules/weather touches dialed-weather).
import { cacheKeyFor, matchesKey, runHourKeys } from "../weather";

/** The core D1 handle. Callers hold their own — consensus takes one as
 * an argument so the cron can pass a non-request binding. */
type CoreDb = DrizzleD1Database;




export { pointSpan } from "./conditions-shape";
export type { Conditions, ConditionsSpan } from "./conditions-shape";

const CHUNK = 20;

/**
One observation cache cell, as a Map key.
*/
function cellKey(latR: number, lngR: number, hourBucket: number): string {
  return `${String(latR)}|${String(lngR)}|${String(hourBucket)}`;
}


interface Locatable {
  id: string;
  lat: number | null;
  lng: number | null;
  startedAt: number;
  /** How far past `startedAt` to read. Without it a 2-hour run reads as
   *  the hour it began in, which is D-5. */
  durationS: number;
}

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
  // Equivalent mutant: an empty `inArray` matches nothing, so the walk
  // would answer with an empty map either way. The return saves the query.
  // Stryker disable next-line ConditionalExpression
  if (entries.length === 0) return new Map();
  const rows = await database
    .select({
      id: runs.id,
      lat: runs.lat,
      lng: runs.lng,
      startedAt: runs.startedAt,
      durationS: runs.durationS,
    })
    .from(runs)
    .where(
      inArray(
        runs.id,
        entries.map((entry) => entry.runId),
      ),
    );
  return observationsForRuns(rows);
}

/**
 * Resolve observations for a batch of runs via cache-key index seeks.
 * Manual-source rows are kept here; callers that aggregate (consensus,
 * coverage) must exclude them — per-run display may show them.
 */
export async function observationsForRuns(
  batch: readonly Locatable[],
): Promise<Map<string, Conditions>> {
  // Every hour the run touched, not just the one it began in. The walk is
  // `runHourKeys` from the weather module rather than a local copy,
  // because `attach.ts` uses the same one to decide which hours to
  // *resolve* — a second copy of the rounding or the cap would let the
  // reader look for an hour the writer never fetched.
  const spans = batch.flatMap((run) =>
    run.lat === null || run.lng === null
      ? []
      : [
          {
            runId: run.id,
            keys: runHourKeys(run.lat, run.lng, run.startedAt, run.durationS),
          },
        ],
  );
  const keyed = spans.flatMap(({ runId, keys }) =>
    keys.map((key) => ({ runId, key })),
  );
  const db = drizzle(env.DIALED_WEATHER);
  // Keyed by cache cell rather than collected into a list: a run spans up
  // to six hours and a page holds two hundred runs, so a linear scan per
  // key is twelve hundred passes over the rows for an answer a lookup
  // gives directly.
  const byCell = new Map<string, ObservationRow>();
  // The chunking is what keeps the `or(...)` bounded, and it is about what
  // D1 *scans* — which is what it bills — not about what comes back. The
  // answer is assembled by matching keys afterwards either way, which is
  // why `chunked` is tested where its mutants are visible rather than
  // excused here.
  for (const chunk of chunked(keyed, CHUNK)) {
    // Equivalent mutant, and the proof is the one the chunking rests on:
    // emptying this arrow widens the `where` to every observation, and the
    // answer is assembled by matching keys against the rows afterwards —
    // so a superset changes what is *scanned* and not what is *returned*.
    // Scanned rows are what D1 bills, which is why the predicate stays.
    //
    // Block form, not `next-line`: the read is one statement spanning five
    // lines, so a `next-line` directive above `.where(` attaches to the
    // statement's first line and silently does nothing.
    // Stryker disable ArrowFunction
    const found = await db
      .select()
      .from(weatherObservations)
      .where(or(...chunk.map(({ key }) => matchesKey(key))));
    // Stryker restore ArrowFunction
    for (const row of found) {
      byCell.set(cellKey(row.latR, row.lngR, row.hourBucket), row);
    }
  }

  const result = new Map<string, Conditions>();
  for (const { runId, keys } of spans) {
    // Aligned with `keys`, so index 0 is the *starting* hour whether or
    // not it resolved. Taking "the first row found" instead would let a
    // run whose start never resolved answer with its second hour, under a
    // field that means "what they set out in".
    const hourRows = keys.map((key) =>
      byCell.get(cellKey(key.latR, key.lngR, key.hourBucket)),
    );
    const [start] = hourRows;
    // The starting hour is what `tempC`/`feelsLikeC` mean, so a run
    // missing it has no conditions at all — the behaviour before this
    // lane, kept. A run missing only its *later* hours still answers, over
    // the hours that did resolve.
    if (start === undefined) continue;
    const hours = hourRows.flatMap((row) => (row === undefined ? [] : [row]));
    result.set(runId, {
      tempC: start.tempC,
      feelsLikeC: start.feelsLikeC,
      precipMm: start.precipMm,
      condition: start.condition,
      windKph: start.windKph,
      source: start.source,
      span: {
        minTempC: Math.min(...hours.map((h) => h.tempC)),
        maxTempC: Math.max(...hours.map((h) => h.tempC)),
        minFeelsLikeC: Math.min(...hours.map((h) => h.feelsLikeC)),
        maxFeelsLikeC: Math.max(...hours.map((h) => h.feelsLikeC)),
      },
    });
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
    matchesKey({ ...cacheKeyFor(lat, lng, new Date()), hourBucket: bucket });
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
 * can import (D-41).
 */
export async function conditionsAt(
  lat: number | undefined,
  lng: number | undefined,
  nowEpochSeconds: number,
): Promise<Conditions | undefined> {
  // Equivalent mutant, and worth writing down why: `roundCoord(undefined)`
  // is `NaN`, not 0, so a half-located lookup keys to a cell nothing can
  // match and answers undefined anyway. The guard says the intent — "we do
  // not know where you are" — and saves the query.
  // Stryker disable next-line ConditionalExpression,LogicalOperator
  if (lat === undefined || lng === undefined) return undefined;
  return currentConditions(lat, lng, nowEpochSeconds);
}
