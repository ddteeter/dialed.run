import { eq } from "drizzle-orm";
import type { DrizzleD1Database } from "drizzle-orm/d1";

import { userProfiles } from "../../db/schema-core";
import type { CountInTotalsChoice } from "./inputs";

/**
 * Whether a runner's runs count in published anonymous totals (D-108 D):
 * the one reader A3 needs, and the one writer, Settings › Sharing's
 * switch. The writer is reached through `requireUserId()`, not the
 * confirmed gate (owner, 2026-10-11): it is the runner's own choice,
 * visible to nobody, and turning totals off must never wait on a confirm.
 */

/**
 * Whether this runner's runs count, and nothing else, which is all A3's
 * private line needs. A runner with no profile row is counted, as the
 * column's default says: nothing creates the row at signup.
 */
export async function countsInTotals(
  db: DrizzleD1Database,
  userId: string,
): Promise<CountInTotalsChoice> {
  const [row] = await db
    .select({ countInTotals: userProfiles.countInTotals })
    .from(userProfiles)
    .where(eq(userProfiles.userId, userId))
    .limit(1);
  return { countInTotals: row?.countInTotals ?? true };
}

/**
 * Settings › Sharing's switch (D-108 D). Off takes effect at the next
 * nightly build of the guides; published reports stay as they are. That
 * is the guide job's to honour, not this writer's.
 *
 * An upsert for `saveCalibration`'s reason — nothing at signup creates the
 * profile row — and its `set` names only this column, so it cannot reset
 * a calibration or the sharing default.
 */
export async function setCountInTotals(
  db: DrizzleD1Database,
  userId: string,
  { countInTotals }: CountInTotalsChoice,
): Promise<CountInTotalsChoice> {
  await db
    .insert(userProfiles)
    .values({ userId, countInTotals })
    .onConflictDoUpdate({
      target: userProfiles.userId,
      set: { countInTotals },
    });
  return { countInTotals };
}
