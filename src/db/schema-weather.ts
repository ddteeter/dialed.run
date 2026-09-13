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
  },
  (t) => [
    uniqueIndex("observations_cache_key").on(t.latR, t.lngR, t.hourBucket),
  ],
);
