/**
 * Onboarding — the module's public API for other modules.
 *
 * Route files import server-fn glue from `./functions` directly (auth's
 * pattern); this barrel is what another module may reach: the runner's
 * time zone (design 142), its one read and the hourly fill `ops` runs.
 */
export { fillMissingTimeZones, runnerTimeZone } from "./time-zone";
