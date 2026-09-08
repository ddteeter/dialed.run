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
import { createStravaApi, type StravaApi } from "./api";

export function stravaApiFromEnv(): StravaApi | undefined {
  const clientId = env.STRAVA_CLIENT_ID;
  const clientSecret = env.STRAVA_CLIENT_SECRET;
  if (clientId === undefined || clientSecret === undefined) return undefined;
  return createStravaApi({ clientId, clientSecret });
}
