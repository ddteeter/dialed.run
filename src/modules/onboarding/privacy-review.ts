import { eq } from "drizzle-orm";
import type { DrizzleD1Database } from "drizzle-orm/d1";

import { user } from "../../db/schema-auth";
import { userProfiles } from "../../db/schema-core";

/**
 * U1's REVIEW tag on the Privacy row (R55·230): it shows when a privacy
 * setting has been added or changed since the runner last opened Privacy,
 * and clears when they open it.
 *
 * **Move this when Privacy changes.** The day, in unix seconds, Privacy's
 * settings last changed: 2026-10-27, when PUBLIC PROFILE and its closet
 * switch arrived (D-151). Add or change a setting on Privacy and set this
 * to that day, and every runner who has not opened Privacy since is
 * tagged.
 */
export const PRIVACY_SETTINGS_CHANGED = Date.UTC(2026, 9, 27) / 1000;

/**
 * Whether the tag shows. A runner who has never opened Privacy has seen it
 * as it stood when their account was made, so a new account starts with
 * no tag and only an account older than the change is asked to look.
 */
export function isReviewDueBy(
  seenAt: number | undefined,
  accountCreatedAt: number,
): boolean {
  return (seenAt ?? accountCreatedAt) < PRIVACY_SETTINGS_CHANGED;
}

/**
 * The tag's state for one runner: when they last opened Privacy, beside
 * when their account was made. No account, no tag.
 */
export async function isPrivacyReviewDue(
  db: DrizzleD1Database,
  userId: string,
): Promise<boolean> {
  const made = db.select({ at: user.createdAt }).from(user);
  const seen = db.select({ at: userProfiles.privacySeenAt }).from(userProfiles);
  const [[account], [profile]] = await db.batch([
    made.where(eq(user.id, userId)),
    seen.where(eq(userProfiles.userId, userId)),
  ]);
  return (
    account !== undefined &&
    isReviewDueBy(
      profile?.at ?? undefined,
      Math.floor(account.at.getTime() / 1000),
    )
  );
}

/**
 * Opening Privacy stamps it, which clears the tag. An upsert for
 * `saveCalibration`'s reason — nothing at signup creates the profile
 * row — and its `set` names only this column.
 */
export async function markPrivacySeen(
  db: DrizzleD1Database,
  userId: string,
  now: number,
): Promise<void> {
  await db
    .insert(userProfiles)
    .values({ userId, privacySeenAt: now })
    .onConflictDoUpdate({
      target: userProfiles.userId,
      set: { privacySeenAt: now },
    });
}
