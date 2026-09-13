import { eq } from "drizzle-orm";
import type { DrizzleD1Database } from "drizzle-orm/d1";

import { userProfiles } from "../../db/schema-core";
import { defaultUnits } from "../../lib/contracts";
import type { Calibration, Preferences } from "./inputs";

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

/**
 * The settings screen's write: two display units and the sharing default.
 *
 * An upsert for the same reason `saveCalibration` is one — nothing else
 * creates this row — and it names only its own three columns, so saving
 * preferences cannot reset a calibration and recalibrating cannot reset
 * preferences. The two screens write disjoint sets on purpose.
 */
export async function savePreferences(
  db: DrizzleD1Database,
  userId: string,
  input: Preferences,
): Promise<void> {
  const preferences = {
    tempUnit: input.tempUnit,
    distanceUnit: input.distanceUnit,
    shareDefault: input.shareDefault,
  };
  await db
    .insert(userProfiles)
    .values({ userId, ...preferences })
    .onConflictDoUpdate({ target: userProfiles.userId, set: preferences });
}

/**
Everything the settings screen shows, including what it does not edit.
*/
export interface CurrentSettings extends Preferences {
  /**
   * Shown as a sentence, edited in O1. `undefined` for someone who reached
   * settings without ever answering the calibration question — possible,
   * because every step past O1 is skippable and O1 itself can be left by
   * the back button.
   */
  thermalLevel: number | undefined;
}

/**
 * What settings reads, in one query.
 *
 * **Defaults are applied here, not in the component.** The columns are
 * nullable — a profile predates the question, or the row does not exist at
 * all — and a `<select>` cannot render "no answer" for a required choice.
 * `defaultUnits` is what the rest of the app already falls back to
 * (`feed/units.ts` does the same), so settings shows the same Fahrenheit
 * and miles a feed reader is already seeing rather than a blank the save
 * would then have to invent a value for.
 *
 * `share_default` is `NOT NULL DEFAULT true`, so its only missing case is
 * a missing row, and `true` there is the contract's "public by default".
 */
export async function currentSettings(
  db: DrizzleD1Database,
  userId: string,
): Promise<CurrentSettings> {
  const [row] = await db
    .select({
      thermalLevel: userProfiles.thermalLevel,
      tempUnit: userProfiles.tempUnit,
      distanceUnit: userProfiles.distanceUnit,
      shareDefault: userProfiles.shareDefault,
    })
    .from(userProfiles)
    .where(eq(userProfiles.userId, userId))
    .limit(1);
  return {
    thermalLevel: row?.thermalLevel ?? undefined,
    tempUnit: row?.tempUnit ?? defaultUnits.temp,
    distanceUnit: row?.distanceUnit ?? defaultUnits.distance,
    shareDefault: row?.shareDefault ?? true,
  };
}

/**
 * Whether this visitor should be sent into onboarding.
 *
 * **A signed-out visitor never is.** `/` is the marketing page and the only
 * thing a logged-out reader can see; bouncing them to a screen that
 * requires a session would be a redirect loop dressed as a feature.
 *
 * **And it is asked on every visit, not once at signup**, which is the
 * whole point (D-52). Every step past O1 is skippable and a runner who
 * bails still has a working app — so bailing has to be *recoverable*, and
 * a one-shot redirect at account creation strands exactly the person the
 * skippable design invites. `onboarding_complete` flips only at P3, so
 * "came back to finish" and "never started" are the same question.
 */
export async function requiresOnboarding(
  db: DrizzleD1Database,
  userId: string | undefined,
): Promise<boolean> {
  if (userId === undefined) return false;
  return !(await hasOnboarded(db, userId));
}
