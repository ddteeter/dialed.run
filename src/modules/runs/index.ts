/**
 * Public API of the runs module. Route files import server-fn glue
 * directly from ./functions (auth's pattern — keeps this barrel loadable
 * in the vitest workers pool, no TanStack virtual entries); other modules
 * (ops, for the queue entry point) import from here.
 */
export { handleImportsBatch, handleImportsDlqBatch } from "./consumer";
export { stravaApiFromEnv } from "./strava/api-from-env";
export { runsAwaitingVerdict } from "./awaiting-verdict";
export { runCountsOf } from "./counts";
export { pruneStravaIds } from "./strava/prune";
// Seam 5 (docs/tasks/125-129): account deletion (task 126, ACC-9) revokes
// a runner's Strava grant through this, never a second copy of it.
export { disconnectStrava } from "./strava/oauth";
