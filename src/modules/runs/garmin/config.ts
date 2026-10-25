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
 * The decision is here, and `functions.ts` reads the bindings into it,
 * because a test inside the isolate cannot change a binding (as Strava's
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

export function garminConfigFrom(
  apiKey: string | undefined,
  ownerUserId: string | undefined,
  // `GARMIN_API_ORIGIN`: set only by e2e, which serves a stub (step 9).
  origin?: string,
): GarminConfig | undefined {
  // Blank is unset: `wrangler secret put` takes an empty value, and an
  // empty owner id must never match anyone.
  const key = apiKey?.trim() ?? "";
  const owner = ownerUserId?.trim() ?? "";
  if (key === "" || owner === "") return undefined;
  return {
    apiKey: key,
    ownerUserId: owner,
    origin: origin === "" ? undefined : origin,
  };
}

/**
The configuration, when this runner is the one it is for.
*/
export function garminConfigFor(
  config: GarminConfig | undefined,
  userId: string,
): GarminConfig | undefined {
  return config?.ownerUserId === userId ? config : undefined;
}

/**
 * What the attribution line says (G1). "Garmin" alone, because the
 * Personal API never names the model; phase 3 takes the model from the
 * Activity API instead. No hand-kept table of product codes.
 */
export const GARMIN_DEVICE_NAME = "Garmin";
