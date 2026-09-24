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
 * Saves the typed city as the profile's city — O1's field, one column.
 *
 * Only `city_label`: a typed city is a label, not a place, and writing it
 * must not disturb the calibration or units O1 saved beside it.
 */
export async function saveConditionsCity(
  userId: string,
  cityLabel: string,
): Promise<void> {
  await drizzle(env.DIALED_CORE)
    .insert(userProfiles)
    .values({ userId, cityLabel })
    .onConflictDoUpdate({ target: userProfiles.userId, set: { cityLabel } });
}
