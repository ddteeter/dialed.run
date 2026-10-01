import { eq } from "drizzle-orm";
import type { drizzle } from "drizzle-orm/d1";

import { user } from "../../db/schema-auth";
import { firstColumnWhere } from "../../lib/sql/keyed-read";
import { emailPreferencesOf } from "./preferences";

type Db = ReturnType<typeof drizzle>;

/**
 * What Settings › Notifications shows (round 26 #19): "Emails go to
 * {address}", and the one switch there is.
 */
export interface NotificationSettings {
  readonly email: string;
  readonly runReminder: boolean;
}

export async function notificationSettings(
  db: Db,
  userId: string,
): Promise<NotificationSettings> {
  const [email = "", switches] = await Promise.all([
    firstColumnWhere(db, user, user.email, eq(user.id, userId)),
    emailPreferencesOf(db, userId),
  ]);
  return { email, runReminder: switches.run_reminder };
}
