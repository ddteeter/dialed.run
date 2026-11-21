/**
 * Public API (docs/tasks/103-weather.md). `attachObservation`,
 * `recordManualObservation` and `forecast` are three of the packet's four;
 * the fourth, `WeatherAttribution`, moved to `src/ui/` in task 115 — it is
 * a presentational anchor with no weather dependency, and reaching it
 * through this barrel pulled `cloudflare:workers` into the client bundle.
 * See that file's own note. `manualReadingsForRuns`/`observationsForRuns` are
 * added because lane 104's packet expects a conditions read API and this is the
 * only module allowed to touch `dialed-weather` (docs/architecture.md).
 * `retryPendingWeather` is exported solely so `modules/dispatch/scheduled.ts` —
 * a different module — can reach it through this barrel per
 * dependency-cruiser's index-only cross-module rule; it is an infra entry
 * point, not a domain one.
 */
export {
  attachObservation,
  recordManualObservation,
  retryPendingWeather,
} from "./attach";
export { forecast } from "./forecast";
// Seasonal normals, for onboarding's starter list (O3). See ./normals for
// why this one is not cached.
export { climateNormalsFor } from "./normals";
// A typed place, as coordinates — E2-lite's typed city. See ./place.
export { resolvePlaceFor } from "./place";
// The zone a place is in, for the profile's cached zone (design 142).
export { timeZoneAt, timeZoneAtFor } from "./zone";
// Each runner's day's budget of provider calls (SA-M13): whether a refusal
// was the budget rather than the provider.
export { isWeatherBudgetSpent } from "./budget";
// The cache key itself, so no other module has to restate its rounding.
export { cacheKeyFor, matchesKey, runHourKeys } from "./store";
// The outbox handler for a deleted run's band, which `feed`'s run delete
// owes (C1): this module is the only one that writes `dialed-weather`.
export { manualConditionsHandler } from "./store";
// The account purge's band step (ACC-9), so `account` touches no weather
// table (design 173).
export { forgetManualBands } from "./store";
export type { CacheKey, ObservationRow } from "./store";
export { manualReadingsForRuns, observationsForRuns } from "./read";
export { conditionsForRuns, zoneField } from "./run-conditions";
// The cache reads feed's conditions are assembled from (design 173): feed
// used to read `weather_observations` itself.
export { newestObservationAt, observationsAtCells } from "./read";
export type { WeatherReading } from "./read";
