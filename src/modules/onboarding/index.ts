/**
 * Onboarding — the module's public API for other modules.
 *
 * Route files import server-fn glue from `./functions` directly (auth's
 * pattern); this barrel is what another module may reach. It holds the one
 * writer of the profile's place (FEED-5), which feed's Your conditions
 * calls, and the schema that writer takes. And the runner's time zone
 * (design 142): the one read of it, and the hourly fill `ops` runs.
 */
export { placeInput, type Place } from "./inputs";
export { savePlace } from "./profile";
export {
  fillMissingTimeZones,
  runnerTimeZone,
  type ZoneDeps,
} from "./time-zone";
