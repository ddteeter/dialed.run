/**
dialed-weather schema (isolated DB — see docs/architecture.md).
*/
import {
  integer,
  real,
  sqliteTable,
  text,
  uniqueIndex,
} from "drizzle-orm/sqlite-core";

export const weatherObservations = /*#__PURE__*/ sqliteTable(
  "weather_observations",
  {
    id: text("id").primaryKey(),
    runId: text("run_id"),
    latR: real("lat_r").notNull(),
    lngR: real("lng_r").notNull(),
    hourBucket: integer("hour_bucket").notNull(),
    tempC: real("temp_c").notNull(),
    feelsLikeC: real("feels_like_c").notNull(),
    humidity: real("humidity").notNull(),
    windKph: real("wind_kph").notNull(),
    precipMm: real("precip_mm").notNull(),
    condition: text("condition").notNull(),
    source: text("source", { enum: ["visualcrossing", "manual"] }).notNull(),
    fetchedAt: integer("fetched_at").notNull(),
    // D-96: the IANA zone of the place observed, as Visual Crossing names
    // it. On the observation rather than the run because observations are
    // a shared cache: a run whose hour is already cached never fetches, so
    // the zone has to be here for a cache hit to supply it. Nullable and
    // additive — manual rows have none, and nothing cached before this
    // column existed does either.
    timeZone: text("time_zone"),
  },
  (t) => [
    uniqueIndex("observations_cache_key").on(t.latR, t.lngR, t.hourBucket),
  ],
);

/**
 * A band a runner set for one run (R2b, D-24), keyed by that run.
 *
 * **Not in `weather_observations`, on purpose.** That table is a shared
 * cache keyed by place and hour: a row there answers for every runner at
 * that cell. A band is one runner's pick for one run, so putting it in the
 * cache handed it to anyone else who ran there that hour — as a hit, which
 * made their run `manual` too, dropped it from consensus and stopped it
 * ever fetching (review blocker B1). Here it belongs to its run and to
 * nothing else, and the cache holds real observations only.
 */
export const manualConditions = /*#__PURE__*/ sqliteTable("manual_conditions", {
  runId: text("run_id").primaryKey(),
  tempC: real("temp_c").notNull(),
  setAt: integer("set_at").notNull(),
});
