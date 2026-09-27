/**
 * Where "Your conditions" looks, when the runner has already told us.
 *
 * Round 22 (E2-lite): *"A runner with a saved city skips this entirely"* —
 * the location prompt, that is — and *"Location denied recovers with a
 * typed city, saved to the profile's city … and the tab never asks
 * again."* This reads `user_profiles`; the city is written by the one
 * writer of those columns, onboarding's `savePlace` (FEED-5).
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
  The profile's city label, if there is one: O1's typed text, or the
  provider's name for a city saved on this tab. A label for a person,
  never parsed into coordinates (O1's own rule).
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
