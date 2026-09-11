import { eq } from "drizzle-orm";
import type { DrizzleD1Database } from "drizzle-orm/d1";

import { userProfiles } from "../../db/schema-core";
import type { Calibration } from "./inputs";

/**
 * O1's write, and the first thing in the app to create a `user_profiles`
 * row at all.
 *
 * **An upsert, not an update.** Nothing else writes this table — auth does
 * not touch it at signup — so a runner reaching O1 has no row, and an
 * `UPDATE` would silently affect nothing and leave them uncalibrated with
 * no error to show for it.
 *
 * The `set` clause names only the calibrated columns on purpose:
 * `display_name`, `share_default` and `onboarding_complete` are other
 * people's business, and recalibrating from settings must not reset them.
 */
export async function saveCalibration(
  db: DrizzleD1Database,
  userId: string,
  input: Calibration,
): Promise<void> {
  const calibrated = {
    thermalLevel: input.thermalLevel,
    cityLabel: input.cityLabel,
    lat: input.lat,
    lng: input.lng,
    tempUnit: input.tempUnit,
    distanceUnit: input.distanceUnit,
  };
  await db
    .insert(userProfiles)
    .values({ userId, ...calibrated })
    .onConflictDoUpdate({ target: userProfiles.userId, set: calibrated });
}

/**
 * The flag that stops onboarding running twice.
 *
 * Set at P3 and nowhere earlier, so a runner who bails halfway keeps what
 * they answered and is offered the rest again. Recalibrating from settings
 * writes the calibration without touching this.
 */
export async function completeOnboarding(
  db: DrizzleD1Database,
  userId: string,
): Promise<void> {
  await db
    .insert(userProfiles)
    .values({ userId, onboardingComplete: true })
    .onConflictDoUpdate({
      target: userProfiles.userId,
      set: { onboardingComplete: true },
    });
}

/**
 * Whether this runner has finished onboarding.
 *
 * A missing row reads as *not complete*, which is the honest answer for an
 * account that has never reached O1 — and the common one, since the row is
 * created by O1 itself.
 */
export async function hasOnboarded(
  db: DrizzleD1Database,
  userId: string,
): Promise<boolean> {
  const [row] = await db
    .select({ complete: userProfiles.onboardingComplete })
    .from(userProfiles)
    .where(eq(userProfiles.userId, userId))
    .limit(1);
  return row?.complete ?? false;
}
