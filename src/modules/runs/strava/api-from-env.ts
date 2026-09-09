/**
 * Builds the live Strava adapter from configured secrets, or undefined
 * when Strava is not set up.
 *
 * Exists so `modules/ops` can hand one to the queue consumer without
 * deep-importing ./api — cross-module imports go through a module's
 * index.ts (CLAUDE.md architecture rules), and Strava configuration is
 * this module's business, not ops'.
 */
import { env } from "../../../env";
import {
  createStravaApi,
  stravaConfigFrom,
  type StravaApi,
  type StravaConfig,
} from "./api";

/**
The configured Strava credentials, or undefined when a human has not set
them yet. The decision is `stravaConfigFrom`'s; this reads the bindings.
*/
// Stryker disable next-line BlockStatement
export function stravaConfigFromEnv(): StravaConfig | undefined {
  return stravaConfigFrom(env.STRAVA_CLIENT_ID, env.STRAVA_CLIENT_SECRET);
}

// Equivalent mutant on the body: the only path a test can reach is the
// unconfigured one, because a binding cannot be changed from inside the
// isolate — which is exactly why the decision lives in `stravaConfigFrom`
// and this is the two-line shell that reads the bindings.
// Stryker disable next-line BlockStatement
export function stravaApiFromEnv(): StravaApi | undefined {
  const config = stravaConfigFromEnv();
  // Same reason as the block above: with no configured binding in the
  // isolate, `config` is always undefined here and the other arm cannot be
  // reached. `test/runs/strava-api.test.ts` covers both arms of the
  // decision where it actually lives.
  // Stryker disable next-line ConditionalExpression
  return config === undefined ? undefined : createStravaApi(config);
}
