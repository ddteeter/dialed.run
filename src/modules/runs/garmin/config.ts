/**
 * Whether "Import from Garmin" exists on this deployment, and for whom
 * (plan 157, phase 1).
 *
 * The Personal API key is personal to the one runner it was issued to and
 * may be used only in tools they run for their own use, so the feature is
 * that runner's and nobody else's: both the key and whose it is are
 * configured, and either one missing hides it. Both are Worker secrets
 * (`docs/deployment.md` §5).
 *
 * The decision is here, and `functions.ts` hands it the bindings, because
 * a test inside the isolate cannot change a binding (as Strava's
 * `stravaConfigFrom`).
 */
export interface GarminConfig {
  apiKey: string;
  ownerUserId: string;
  /**
  Garmin's own origin unless a test points it at a stub.
  */
  origin: string | undefined;
}

/**
The three settings it reads, by the names the Worker binds them under
(`src/env/env.d.ts`), so a renamed secret fails the build here.
*/
export type GarminVars = Pick<
  Cloudflare.Env,
  "GARMIN_API_KEY" | "GARMIN_OWNER_USER_ID" | "GARMIN_API_ORIGIN"
>;

/**
The configuration, when this runner is the one it is for; undefined for
anyone else, and for everyone until a human sets both secrets (law 5).
*/
export function garminConfigFor(
  vars: GarminVars,
  userId: string,
): GarminConfig | undefined {
  // Blank is unset: `wrangler secret put` takes an empty value, and an
  // empty owner id must never match anyone.
  const apiKey = vars.GARMIN_API_KEY?.trim() ?? "";
  const ownerUserId = vars.GARMIN_OWNER_USER_ID?.trim() ?? "";
  if (apiKey === "" || ownerUserId === "" || ownerUserId !== userId) {
    return undefined;
  }
  // `GARMIN_API_ORIGIN`: set only by e2e, which serves a stub.
  const origin = vars.GARMIN_API_ORIGIN?.trim() ?? "";
  return { apiKey, ownerUserId, origin: origin === "" ? undefined : origin };
}

/**
 * What the attribution line says (G1). "Garmin" alone, because the
 * Personal API never names the model; phase 3 takes the model from the
 * Activity API instead. No hand-kept table of product codes.
 */
export const GARMIN_DEVICE_NAME = "Garmin";
