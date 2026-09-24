/**
 * Minimal notifications (owned by lane 102 at MVP). Dedupe is structural:
 * UNIQUE(user_id, kind, subject_id) + INSERT OR IGNORE, so every creator
 * is safely re-runnable (resilience law 1).
 */
import {
  and,
  count,
  desc,
  eq,
  gte,
  isNull,
  ne,
  notInArray,
  or,
} from "drizzle-orm";

import { notifications, outfitEntries, runs } from "../../db/schema-core";
import { newUlid } from "../../lib/ids";
import type { NotificationsDb } from "./db";
import { nowSeconds } from "../../lib/now";

export type NotificationKind =
  "kit_reminder" | "import_failed" | "strava_reminder" | "strava_broken";

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
/**
 * The insert as a *statement*, not an awaited call, so a caller can put it
 * in the same `db.batch()` as the write it belongs with.
 *
 * D1 has no interactive transactions; `batch()` is the only atomicity
 * primitive (CLAUDE.md §D1 query discipline). A notification that records
 * something the database now says happened has to land with it, or a
 * failure in between leaves a state change nobody was told about.
 */
export function notificationInsert(
  db: NotificationsDb,
  draft: NotificationDraft,
) {
  return db
    .insert(notifications)
    .values({
      id: newUlid(),
      userId: draft.userId,
      kind: draft.kind,
      subjectId: draft.subjectId,
      body: draft.body,
      read: false,
      createdAt: nowSeconds(),
    })
    .onConflictDoNothing();
}

/**
Standalone form, for the callers with nothing to be atomic with.
*/
export async function createNotification(
  db: NotificationsDb,
  draft: NotificationDraft,
): Promise<void> {
  await notificationInsert(db, draft);
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
    .where(unreadOf(userId));
  return onlyCount(rows);
}

/**
 * The one row a `count()` answers with.
 */
function onlyCount(rows: readonly { n: number }[]): number {
  // Unreachable fallback: `count()` always answers with exactly one row.
  // It is here because `noUncheckedIndexedAccess` types `rows[0]` as
  // possibly undefined, which is the compiler being right about arrays in
  // general rather than about this query.
  // Stryker disable next-line OptionalChaining
  return rows[0]?.n ?? 0;
}

/**
 * How far back a run still counts as waiting for its verdict — round 22's
 * bell ruling: *"Runs with a kit or not, without a verdict, from the last
 * 14 days."* Older than that and the run is history, not a to-do.
 */
export const VERDICT_WAIT_WINDOW_S = 14 * 24 * 3600;

/**
 * The runs this runner still owes a verdict: started inside the window,
 * and either with no outfit entry or with one whose verdict is empty.
 *
 * One LEFT JOIN answers both halves — a run with no entry joins to NULLs,
 * so `verdict IS NULL` is true of it and of an entry nobody judged, which
 * is exactly "with a kit or not". Index-backed on both sides:
 * `runs_user_started` bounds the scan by user and start, and the UNIQUE
 * `entries_run` is the probe.
 */
function waitingRuns(db: NotificationsDb, userId: string, since: number) {
  return db
    .select({ id: runs.id })
    .from(runs)
    .leftJoin(outfitEntries, eq(outfitEntries.runId, runs.id))
    .where(
      and(
        eq(runs.userId, userId),
        gte(runs.startedAt, since),
        isNull(outfitEntries.verdict),
      ),
    );
}

/**
This runner's unread rows — what the dot counts and what mark-all clears.
*/
function unreadOf(userId: string) {
  return and(eq(notifications.userId, userId), eq(notifications.read, false));
}

/**
 * What the bell shows (round 22, item 13): a **number** when there are
 * runs waiting for a verdict, because each one is a thing to do, and
 * otherwise a **dot** for anything unread. Both counts in one batch.
 */
export interface BellState {
  unreadCount: number;
  verdictsWaiting: number;
}

export async function bellState(
  db: NotificationsDb,
  userId: string,
  nowEpochSeconds: number,
): Promise<BellState> {
  const since = nowEpochSeconds - VERDICT_WAIT_WINDOW_S;
  const waiting = waitingRuns(db, userId, since).as("w");
  const [unread, owed] = await db.batch([
    db.select({ n: count() }).from(notifications).where(unreadOf(userId)),
    db.select({ n: count() }).from(waiting),
  ]);
  return {
    unreadCount: onlyCount(unread),
    verdictsWaiting: onlyCount(owed),
  };
}

/**
 * Marks everything read **except a verdict still owed.** Round 22: *"Verdict
 * rows stay unread until the verdict is logged — marking can't clear a
 * to-do."* A `kit_reminder`'s subject is its run, so the reminders left
 * unread are exactly those whose run is still in the waiting set; once the
 * verdict lands, the next mark-all takes them with the rest.
 */
export async function markAllNotificationsRead(
  db: NotificationsDb,
  userId: string,
  nowEpochSeconds: number,
): Promise<void> {
  const since = nowEpochSeconds - VERDICT_WAIT_WINDOW_S;
  const owed = waitingRuns(db, userId, since);
  const notAToDo = or(
    ne(notifications.kind, "kit_reminder"),
    notInArray(notifications.subjectId, owed),
  );
  await db
    .update(notifications)
    .set({ read: true })
    .where(and(unreadOf(userId), notAToDo));
}
