/**
 * Public API (docs/tasks/103-weather.md). `attachObservation`,
 * `recordManualObservation`, `forecast`, and `WeatherAttribution` are the
 * packet's four; `observationForRun`/`observationsForRuns` are added
 * because lane 104's packet expects a conditions read API and this is the
 * only module allowed to touch `dialed-weather` (docs/architecture.md).
 * `retryPendingWeather` is exported solely so `modules/ops/scheduled.ts` —
 * a different module — can reach it through this barrel per
 * dependency-cruiser's index-only cross-module rule; it is an infra entry
 * point, not a domain one.
 */
export { attachObservation, recordManualObservation, retryPendingWeather } from "./attach";
export { WeatherAttribution } from "./components/WeatherAttribution";
export { forecast } from "./forecast";
// The cache key itself, so no other module has to restate its rounding.
export { cacheKeyFor, matchesKey } from "./store";
export type { CacheKey } from "./store";
export { observationForRun, observationsForRuns } from "./read";
export type { WeatherReading } from "./read";
