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
import {
  bandObservation,
  cacheKeyFor,
  manualBandsFor,
  toWeatherObservation,
} from "./store";

/** A resolved observation plus whether it came from a real fetch or a
 * user-typed fallback — 104 shows manual readings differently. */
export type WeatherReading = WeatherObservation & {
  source: "visualcrossing" | "manual";
};

function keyString(latR: number, lngR: number, hourBucket: number): string {
  return `${String(latR)}|${String(lngR)}|${String(hourBucket)}`;
}

/**
 * The bands runners set for these runs (R2b), as readings, by run id.
 *
 * A band is its run's conditions and nobody else's (B1): it is read by run
 * id, never by cache cell, so another runner at the same place and hour
 * never sees it. Tagged `manual`, which is what every aggregate excludes.
 * A run with no band is simply absent — its conditions, if any, are the
 * real observation at its cell.
 */
export async function manualReadingsForRuns(
  runIds: readonly string[],
): Promise<Map<string, WeatherReading>> {
  const bands = await manualBandsFor(runIds);
  return new Map(
    bands.map((band) => [
      band.runId,
      { ...bandObservation(band), source: "manual" as const },
    ]),
  );
}

/**
 * Consensus batch read (104's "your conditions" block): real observations
 * only — a band is never in the cache, and a legacy manual row still there
 * is excluded from every aggregate the module exposes (contracts.md). Bounded
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
    .select({
      id: runs.id,
      lat: runs.lat,
      lng: runs.lng,
      startedAt: runs.startedAt,
    })
    .from(runs)
    .where(or(...runIds.map((id) => eq(runs.id, id))));

  // Dropped rather than keyed, and the distinction matters: `cacheKeyFor`
  // rounds, so a null coordinate keys to 0 — a run with no location would
  // be handed the weather at Null Island, which is a real place in the
  // cache the moment anyone runs near the Gulf of Guinea.
  const keyed = runRows.flatMap((r) =>
    r.lat === null || r.lng === null
      ? []
      : [
          {
            runId: r.id as Ulid,
            key: cacheKeyFor(r.lat, r.lng, new Date(r.startedAt * 1000)),
          },
        ],
  );
  // Equivalent mutant: skipping this return changes no answer — the loop
  // at the bottom is keyed off `keyed`, so an empty one yields an empty
  // map either way. What it saves is a query that would otherwise scan
  // every non-manual observation.
  // Stryker disable next-line ConditionalExpression,EqualityOperator,BlockStatement
  if (keyed.length === 0) {
    return result;
  }

  // Equivalent mutant: emptying this callback widens the scan to every
  // non-manual row and cannot change the result, which is looked up by
  // cell key afterwards. It is a query-cost guard, and cost is the one
  // thing no assertion here can see.
  // Stryker disable next-line ArrowFunction
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
    .where(
      and(or(...cellConditions), ne(weatherObservations.source, "manual")),
    );

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
