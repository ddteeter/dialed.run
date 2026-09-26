/**
 * Public API (docs/tasks/103-weather.md). `attachObservation`,
 * `recordManualObservation` and `forecast` are three of the packet's four;
 * the fourth, `WeatherAttribution`, moved to `src/ui/` in task 115 — it is
 * a presentational anchor with no weather dependency, and reaching it
 * through this barrel pulled `cloudflare:workers` into the client bundle.
 * See that file's own note. `manualReadingsForRuns`/`observationsForRuns` are
 * added because lane 104's packet expects a conditions read API and this is the
 * only module allowed to touch `dialed-weather` (docs/architecture.md).
 * `retryPendingWeather` is exported solely so `modules/ops/scheduled.ts` —
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
export { climateNormals } from "./normals";
// A typed place, as coordinates — E2-lite's typed city. See ./place.
export { resolvePlace } from "./place";
// The cache key itself, so no other module has to restate its rounding.
export { cacheKeyFor, matchesKey, runHourKeys } from "./store";
export type { CacheKey } from "./store";
export { manualReadingsForRuns, observationsForRuns } from "./read";
export type { WeatherReading } from "./read";
