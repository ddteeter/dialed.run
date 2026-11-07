import { eq } from "drizzle-orm";
import type { DrizzleD1Database } from "drizzle-orm/d1";

import { userProfiles } from "../../db/schema-core";
import type { ThemeChoice } from "../../lib/contracts";

/**
 * U1 › Display › Theme (R48·133, design 185): the account's value, which
 * takes over from the device's on sign-in. The one reader and the one
 * writer of `user_profiles.theme`.
 */

/**
 * The runner's choice, or the system for nobody signed in, which asks
 * nothing. A runner with no profile row follows the system too, as the
 * column's default says: nothing creates the row at signup.
 */
export async function ownTheme(
  db: DrizzleD1Database,
  userId: string | undefined,
): Promise<ThemeChoice> {
  if (userId === undefined) return "system";
  const [row] = await db
    .select({ theme: userProfiles.theme })
    .from(userProfiles)
    .where(eq(userProfiles.userId, userId))
    .limit(1);
  return row?.theme ?? "system";
}

/**
 * The Theme row's save, at once and with no Save button. An upsert for
 * `setCountInTotals`' reason (no row at signup), and its `set` names only
 * this column.
 */
export async function setOwnTheme(
  db: DrizzleD1Database,
  userId: string,
  theme: ThemeChoice,
): Promise<{ theme: ThemeChoice }> {
  await db
    .insert(userProfiles)
    .values({ userId, theme })
    .onConflictDoUpdate({ target: userProfiles.userId, set: { theme } });
  return { theme };
}
