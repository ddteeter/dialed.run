/**
 * Minimal notifications (owned by lane 102 at MVP). Dedupe is structural:
 * UNIQUE(user_id, kind, subject_id) + INSERT OR IGNORE, so every creator
 * is safely re-runnable (resilience law 1).
 */
import { and, count, desc, eq } from "drizzle-orm";

import { notifications } from "../../db/schema-core";
import { newUlid } from "../../lib/ids";
import type { CoreDb } from "./core-db";

export type NotificationKind =
  | "kit_reminder"
  | "import_failed"
  | "strava_reminder"
  | "strava_broken";

export interface NotificationDraft {
  userId: string;
  kind: NotificationKind;
  subjectId: string;
  body: string;
}

/**
Idempotent: a duplicate (user, kind, subject) is a silent no-op.
*/
export async function createNotification(
  db: CoreDb,
  draft: NotificationDraft,
): Promise<void> {
  await db
    .insert(notifications)
    .values({
      id: newUlid(),
      userId: draft.userId,
      kind: draft.kind,
      subjectId: draft.subjectId,
      body: draft.body,
      read: 0,
      createdAt: Math.floor(Date.now() / 1000),
    })
    .onConflictDoNothing();
}

export async function listNotifications(db: CoreDb, userId: string) {
  return db
    .select()
    .from(notifications)
    .where(eq(notifications.userId, userId))
    .orderBy(desc(notifications.createdAt), desc(notifications.id))
    .limit(50);
}

export async function unreadNotificationCount(
  db: CoreDb,
  userId: string,
): Promise<number> {
  const rows = await db
    .select({ n: count() })
    .from(notifications)
    .where(and(eq(notifications.userId, userId), eq(notifications.read, 0)));
  return rows[0]?.n ?? 0;
}

export async function markAllNotificationsRead(
  db: CoreDb,
  userId: string,
): Promise<void> {
  await db
    .update(notifications)
    .set({ read: 1 })
    .where(and(eq(notifications.userId, userId), eq(notifications.read, 0)));
}
