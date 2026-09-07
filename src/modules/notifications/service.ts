/**
 * Minimal notifications (owned by lane 102 at MVP). Dedupe is structural:
 * UNIQUE(user_id, kind, subject_id) + INSERT OR IGNORE, so every creator
 * is safely re-runnable (resilience law 1).
 */
import { and, count, desc, eq } from "drizzle-orm";

import { notifications } from "../../db/schema-core";
import { newUlid } from "../../lib/ids";
import type { NotificationsDb } from "./db";

export type NotificationKind =
  | "kit_reminder"
  | "import_failed"
  | "strava_reminder"
  | "strava_broken";

/**
 * What this notification is *about* — the thing it links to, and the key
 * that makes redelivery idempotent (the row is UNIQUE on
 * user + kind + subject).
 *
 * | kind            | subject                                          |
 * | --------------- | ------------------------------------------------ |
 * | kit_reminder    | the run id                                       |
 * | import_failed   | the import id                                    |
 * | strava_reminder | the Strava activity id (`event.object_id`)       |
 * | strava_broken   | none — the subject is the connection itself      |
 *
 * `strava_broken` passing the userId was "this kind has no subject" in
 * disguise, which made the field read as meaningless. It is `null` now, so
 * the shape says what is true. The dedupe still works: SQLite treats NULLs
 * as distinct in a UNIQUE index, so the guard for that kind is the
 * status transition in oauth.ts, not this key — a connection only becomes
 * broken from ok.
 */
export interface NotificationDraft {
  userId: string;
  kind: NotificationKind;
  /**
  Omitted for kinds that have no subject — drizzle writes SQL NULL.
  */
  subjectId?: string;
  body: string;
}

/**
Idempotent: a duplicate (user, kind, subject) is a silent no-op.
*/
export async function createNotification(
  db: NotificationsDb,
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
      read: false,
      createdAt: Math.floor(Date.now() / 1000),
    })
    .onConflictDoNothing();
}

export async function listNotifications(db: NotificationsDb, userId: string) {
  return db
    .select()
    .from(notifications)
    .where(eq(notifications.userId, userId))
    .orderBy(desc(notifications.createdAt), desc(notifications.id))
    .limit(50);
}

export async function unreadNotificationCount(
  db: NotificationsDb,
  userId: string,
): Promise<number> {
  const rows = await db
    .select({ n: count() })
    .from(notifications)
    .where(and(eq(notifications.userId, userId), eq(notifications.read, false)));
  return rows[0]?.n ?? 0;
}

export async function markAllNotificationsRead(
  db: NotificationsDb,
  userId: string,
): Promise<void> {
  await db
    .update(notifications)
    .set({ read: true })
    .where(and(eq(notifications.userId, userId), eq(notifications.read, false)));
}
