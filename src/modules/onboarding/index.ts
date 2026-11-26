/**
 * Onboarding — the module's public API for other modules.
 *
 * Route files import server-fn glue from `./functions` directly (auth's
 * pattern); this barrel is what another module may reach: the runner's
 * time zone (design 142), its one read and the hourly fill `ops` runs.
 * `savePlace`, the one writer of the profile's place (FEED-5), is here
 * for the tests that seed a place through it.
 */
export { savePlace } from "./profile";
export {
  fillMissingTimeZones,
  runnerTimeZone,
  type SaveZoneDeps,
  type ZoneDeps,
} from "./time-zone";
