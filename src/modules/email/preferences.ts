/**
 * A runner's email switches (ACC-11; decision D-43): read at send time,
 * written by Settings › Notifications and by the unsubscribe link.
 */
import { and, eq } from "drizzle-orm";
import type { drizzle } from "drizzle-orm/d1";

import { notificationPreferences } from "../../db/schema-core";
import type { EmailPreferenceKind } from "../../lib/email";
import { columnWhere } from "../../lib/keyed-read";
import { nowSeconds } from "../../lib/now";

type Db = ReturnType<typeof drizzle>;

/**
 * Where a kind starts before the runner touches it. The reminder is on by
 * default (round 26 #19): it is the one message that gets a run logged.
 */
const DEFAULT_ON: Readonly<Record<EmailPreferenceKind, boolean>> = {
  run_reminder: true,
};

/**
Whether this runner wants this kind of email.
*/
export async function isEmailWanted(
  db: Db,
  userId: string,
  kind: EmailPreferenceKind,
): Promise<boolean> {
  // One row at most: the table is unique on (runner, kind).
  const [isOn] = await columnWhere(
    db,
    notificationPreferences,
    notificationPreferences.email,
    and(
      eq(notificationPreferences.userId, userId),
      eq(notificationPreferences.kind, kind),
    ),
  );
  return isOn ?? DEFAULT_ON[kind];
}

/**
Every switch, for Settings › Notifications.
*/
export async function emailPreferencesOf(
  db: Db,
  userId: string,
): Promise<Record<EmailPreferenceKind, boolean>> {
  const rows = await db
    .select({
      kind: notificationPreferences.kind,
      email: notificationPreferences.email,
    })
    .from(notificationPreferences)
    .where(eq(notificationPreferences.userId, userId));
  const switches = { ...DEFAULT_ON };
  for (const row of rows) switches[row.kind] = row.email;
  return switches;
}

/**
 * Turn a kind on or off. An upsert, so it is safe to repeat — opening an
 * unsubscribe link twice turns it off twice.
 */
export function setEmailPreference(
  db: Db,
  userId: string,
  kind: EmailPreferenceKind,
  isOn: boolean,
) {
  const now = nowSeconds();
  return db
    .insert(notificationPreferences)
    .values({ userId, kind, email: isOn, updatedAt: now })
    .onConflictDoUpdate({
      target: [notificationPreferences.userId, notificationPreferences.kind],
      set: { email: isOn, updatedAt: now },
    });
}
