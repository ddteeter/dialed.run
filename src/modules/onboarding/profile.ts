import { eq } from "drizzle-orm";
import type { DrizzleD1Database } from "drizzle-orm/d1";

import { userProfiles } from "../../db/schema-core";
import {
  audienceOfShareToggle,
  defaultUnits,
  isSharedAudience,
} from "../../lib/contracts";
import { orSqlNull } from "../../lib/sql/sql-null";
import type {
  Calibration,
  Place,
  Preferences,
  SharingChoice,
  UnitsChoice,
} from "./inputs";

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
 * `username`, `share_default` and `onboarding_complete` are other
 * people's business, and recalibrating from settings must not reset them.
 *
 * **The place goes through `placeWrite`, the one writer of it** (FEED-5),
 * in the same batch as the rest: one answer, so it lands whole or not at
 * all. A calibration that answered no place has nothing for it to write,
 * and the stored place is left alone.
 */
export async function saveCalibration(
  db: DrizzleD1Database,
  userId: string,
  input: Calibration,
): Promise<void> {
  const calibrated = {
    thermalLevel: input.thermalLevel,
    tempUnit: input.tempUnit,
    distanceUnit: input.distanceUnit,
  };
  const calibration = db
    .insert(userProfiles)
    .values({ userId, ...calibrated })
    .onConflictDoUpdate({ target: userProfiles.userId, set: calibrated });
  const place = placeWrite(db, userId, input);
  await (place === undefined ? calibration : db.batch([calibration, place]));
}

/**
 * Your conditions' Use this: a place the runner found and confirmed,
 * written through `placeWrite`.
 *
 * Answers with what it saved, so the screen shows the stored place rather
 * than its own copy of what it sent.
 */
export async function savePlace(
  db: DrizzleD1Database,
  userId: string,
  place: Place,
): Promise<Place> {
  await placeWrite(db, userId, place);
  return place;
}

/**
 * **The one writer of the profile's place** (FEED-5): the three columns
 * `user_profiles` keeps it in, written together, as a statement not yet
 * sent — `savePlace` awaits it, `saveCalibration` batches it. `undefined`
 * when no part of a place arrived: a recalibration that answered only the
 * thermal question leaves the stored place alone rather than erasing it.
 *
 * An upsert for `saveCalibration`'s reason — nothing else creates this
 * row — and its `set` names only the place, so a runner's calibration,
 * units and sharing default are untouched.
 *
 * **Drizzle drops an `undefined` key from `set`**, so writing a new place
 * as `{ cityLabel, lat: undefined, lng: undefined }` left the *old*
 * coordinates under the new label: a runner who moved from Minneapolis to
 * a typed "Austin" kept Minneapolis's weather. So when any part of a place
 * arrives, the parts that did not are written as NULL (`orSqlNull`) — the
 * browser's location, say, arrives as coordinates with no label.
 */
function placeWrite(
  db: DrizzleD1Database,
  userId: string,
  place: Pick<Calibration, "cityLabel" | "lat" | "lng">,
) {
  const { cityLabel, lat, lng } = place;
  if ([cityLabel, lat, lng].every((part) => part === undefined)) {
    return;
  }
  const columns = {
    cityLabel: orSqlNull(cityLabel),
    lat: orSqlNull(lat),
    lng: orSqlNull(lng),
  };
  return db
    .insert(userProfiles)
    .values({ userId, ...columns })
    .onConflictDoUpdate({ target: userProfiles.userId, set: columns });
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
// fallow-ignore-next-line code-duplication -- rhymes with feed/share-default.ts's defaultAudienceFor: same select-by-userId-with-limit-1-then-??-default shape, but a different column with a different default (not-yet-onboarded vs public-by-default) that will evolve on its own product timeline
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
 * A settings sub-page's write: the units, or the sharing default.
 *
 * An upsert for the same reason `saveCalibration` is one — nothing else
 * creates this row — and it names only the columns it was handed, so
 * saving units cannot reset the sharing default, saving sharing cannot
 * reset units, and neither can reset a calibration. Each sub-page is its
 * own small form (round 22, item 20), and each writes a disjoint set.
 *
 * The input is whatever the sub-page's schema parsed (`unitsInput`,
 * `sharingInput`), so no field outside those two sets can reach it.
 */
export async function savePreferences(
  db: DrizzleD1Database,
  userId: string,
  input: UnitsChoice | SharingChoice,
): Promise<void> {
  const columns = preferenceColumns(input);
  await db
    .insert(userProfiles)
    .values({ userId, ...columns })
    .onConflictDoUpdate({ target: userProfiles.userId, set: columns });
}

/**
 * The columns a sub-page's answer writes. The sharing default goes to
 * `default_audience` and to `share_default` with it, until C1
 * (design 131): the boolean is what a version a rollback could restore
 * still reads, so leaving it behind would undo a runner's opt-out there.
 */
function preferenceColumns(
  input: UnitsChoice | SharingChoice,
): UnitsChoice | (SharingChoice & { shareDefault: boolean }) {
  return "defaultAudience" in input
    ? { ...input, shareDefault: isSharedAudience(input.defaultAudience) }
    : input;
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
 * The default audience is read from `share_default` until PR B reads
 * `default_audience` (design 131): the writers keep the two in step.
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
    defaultAudience: audienceOfShareToggle(row?.shareDefault ?? true),
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
 * whole point (R-52). Every step past O1 is skippable and a runner who
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
