/**
 * Where "Your conditions" looks, when the runner has already told us.
 *
 * Round 22 (E2-lite): *"A runner with a saved city skips this entirely"* —
 * the location prompt, that is — and *"Location denied recovers with a
 * typed city, saved to the profile's city … and the tab never asks
 * again."* Both read and write `user_profiles`, the same columns O1 fills.
 */
import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/d1";

import { userProfiles } from "../../db/schema-core";
import { env } from "../../env";
import { resolvedCity } from "./inputs";

export interface ConditionsHome {
  /**
  Saved coordinates, from O1's "use my location" — enough to match on.
  */
  coords: { lat: number; lng: number } | undefined;
  /**
  The city the runner typed, if they did. A label for a person, never
  parsed into coordinates (O1's own rule).
  */
  cityLabel: string | undefined;
}

export async function conditionsHome(userId: string): Promise<ConditionsHome> {
  const [row] = await drizzle(env.DIALED_CORE)
    .select({
      lat: userProfiles.lat,
      lng: userProfiles.lng,
      cityLabel: userProfiles.cityLabel,
    })
    .from(userProfiles)
    .where(eq(userProfiles.userId, userId))
    .limit(1);
  const lat = row?.lat ?? undefined;
  const lng = row?.lng ?? undefined;
  return {
    coords: lat === undefined || lng === undefined ? undefined : { lat, lng },
    cityLabel: row?.cityLabel ?? undefined,
  };
}

/**
 * Saves the typed city as the profile's place: the label the runner typed,
 * and where the weather provider found it (owner's ruling, 2026-09-24).
 * O1's three columns and no others, so the calibration and units saved
 * beside them are untouched.
 *
 * A city the provider cannot find throws `resolvedCity`'s field issue and
 * saves nothing; a provider that is down throws its own error, which the
 * form reads as a failure — one attempt either way (law 3).
 *
 * `resolve` is the weather module's, handed in by the server function so
 * this can be tested without the network.
 */
export async function saveConditionsCity(
  userId: string,
  cityLabel: string,
  resolve: (label: string) => Promise<{ lat: number; lng: number } | undefined>,
): Promise<{ lat: number; lng: number }> {
  const { cityLabel: place } = resolvedCity.parse({
    cityLabel: await resolve(cityLabel),
  });
  const saved = { cityLabel, lat: place.lat, lng: place.lng };
  await drizzle(env.DIALED_CORE)
    .insert(userProfiles)
    .values({ userId, ...saved })
    .onConflictDoUpdate({ target: userProfiles.userId, set: saved });
  return place;
}
