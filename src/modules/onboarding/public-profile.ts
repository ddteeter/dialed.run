import { and, eq, sql } from "drizzle-orm";
import type { DrizzleD1Database } from "drizzle-orm/d1";

import { userProfiles } from "../../db/schema-core";
import { profileCacheTags, type PurgeTags } from "../../lib/cache-tags";
import {
  SHARED_AUDIENCE,
  WORLD_AUDIENCE,
  writableAudienceOf,
} from "../../lib/contracts";
import type { WritableAudience } from "../../lib/contracts";
import { sharingDefaultRule } from "./inputs";
import type { PublicProfileChoice, SharingChoice } from "./inputs";
import { savePreferences } from "./profile";

/**
 * D-149's two profile switches and the one rule tying them to the sharing
 * default (round 41 #86b): `world` can be a runner's default only while
 * their profile is public, and turning the profile off takes a PUBLIC
 * default back to SHARED in the same statement.
 */

/**
What the PUBLIC PROFILE group shows after a switch: both switches, and the default they may have moved.
*/
export interface PublicProfileState {
  publicProfile: boolean;
  publicCloset: boolean;
  defaultAudience: WritableAudience;
}

/**
 * Settings › Privacy's NEW RUNS save. A SHARED or PRIVATE default is
 * `savePreferences`' upsert. A PUBLIC one is an `UPDATE … WHERE
 * public_profile = 1`, so the check and the write are one statement on
 * the primary: a profile turned off in another tab between a read and a
 * write cannot leave a PUBLIC default behind. Nothing written is refused
 * with `sharingDefaultRule`'s message on the field.
 */
export async function saveSharing(
  db: DrizzleD1Database,
  userId: string,
  input: SharingChoice,
): Promise<void> {
  if (input.defaultAudience !== WORLD_AUDIENCE) {
    await savePreferences(db, userId, input);
    return;
  }
  const written = await db
    .update(userProfiles)
    .set({ defaultAudience: WORLD_AUDIENCE })
    .where(
      and(
        eq(userProfiles.userId, userId),
        eq(userProfiles.publicProfile, true),
      ),
    )
    .returning({ userId: userProfiles.userId });
  sharingDefaultRule.parse({ ...input, publicProfile: written.length > 0 });
}

/**
 * One switch of the PUBLIC PROFILE group, saved as it is switched.
 *
 * An upsert for `saveCalibration`'s reason (nothing at signup creates the
 * row), whose `set` names only the switch it was handed: "Show my closet"
 * keeps its value while the profile is off. Turning the profile off also
 * moves a PUBLIC default to SHARED, in the same statement; kits already
 * PUBLIC stay public, since an entry's audience is its own.
 */
export async function setPublicProfile(
  db: DrizzleD1Database,
  userId: string,
  choice: PublicProfileChoice,
  purge: PurgeTags,
): Promise<PublicProfileState> {
  const row = await db
    .insert(userProfiles)
    .values({ userId, ...choice })
    .onConflictDoUpdate({ target: userProfiles.userId, set: setOf(choice) })
    .returning({
      publicProfile: userProfiles.publicProfile,
      publicCloset: userProfiles.publicCloset,
      defaultAudience: userProfiles.defaultAudience,
      username: userProfiles.username,
    })
    // An upsert always returns its one row.
    .get();
  // Design 160: either switch changes what `/@handle` shows — off takes
  // the profile or the rotation back, on replaces the not-public page
  // cached at the handle's path — so the edge is told either way.
  purge(profileCacheTags(userId, row.username));
  return {
    publicProfile: row.publicProfile,
    publicCloset: row.publicCloset,
    defaultAudience: writableAudienceOf(row.defaultAudience),
  };
}

/**
 * What a switch writes over an existing row. Off also takes a PUBLIC
 * default back to SHARED: a PUBLIC default with no public profile is the
 * state D-149 rules out.
 */
function setOf(choice: PublicProfileChoice) {
  if (!("publicProfile" in choice) || choice.publicProfile) return choice;
  return {
    publicProfile: false,
    defaultAudience: sql`CASE WHEN ${userProfiles.defaultAudience} = ${WORLD_AUDIENCE} THEN ${SHARED_AUDIENCE} ELSE ${userProfiles.defaultAudience} END`,
  };
}
