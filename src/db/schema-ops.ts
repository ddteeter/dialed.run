/**
 * dialed-ops schema (design 165): data about the app, never about anyone.
 *
 * What may live here: **no personal data, and nothing that must commit in
 * the same batch as a core write**, because nothing is atomic across two
 * databases (law 8c). Core is the database every user write waits on, so
 * what is not a user's stays out of it. `outbox`, `gave_up` and
 * `processed_webhook_events` look like ops data and stay in core: each is
 * written in one batch with the user write it belongs to.
 */
import {
  integer,
  primaryKey,
  real,
  sqliteTable,
  text,
} from "drizzle-orm/sqlite-core";

/**
 * One UTC day of speed, per route, metric and device, rolled up from the
 * `VITALS` dataset by the daily firing (`modules/ops/vitals-rollup.ts`).
 * Analytics Engine keeps about three months; this keeps the shape of every
 * day after that. A re-run of a day overwrites its rows (law 1).
 *
 * For a `server` row, `device` holds the status class (`2xx` … `5xx`),
 * the same position the data point stores it in. Percentiles are weighted
 * by Analytics Engine's sample interval, and `n` is the weighted count:
 * the number of measurements the sample stands for.
 */
export const perfDaily = /*#__PURE__*/ sqliteTable(
  "perf_daily",
  {
    // `YYYY-MM-DD`, UTC.
    day: text("day").notNull(),
    route: text("route").notNull(),
    metric: text("metric").notNull(),
    device: text("device").notNull(),
    p50: real("p50").notNull(),
    p75: real("p75").notNull(),
    p95: real("p95").notNull(),
    n: integer("n").notNull(),
  },
  (table) => [
    primaryKey({
      columns: [table.day, table.route, table.metric, table.device],
    }),
  ],
);
