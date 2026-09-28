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
  getTableColumns,
  isNull,
  ne,
  notInArray,
  or,
  sql,
} from "drizzle-orm";

import { notifications, outfitEntries, runs } from "../../db/schema-core";
import { newUlid } from "../../lib/ids";
import { BELL_NUMBER_CAP } from "./bell-cap";
import type { NotificationsDb } from "./db";
import { nowSeconds } from "../../lib/now";

export type NotificationKind =
  | "kit_reminder"
  | "import_failed"
  | "strava_reminder"
  | "strava_broken"
  | "content_removed";

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
 * | strava_broken   | the deauthorization event's time                 |
 * | content_removed | the removed entry or photo's id (128 · SAF-8)    |
 *
 * A kind with no subject would pass `null`, and SQLite treats NULLs as
 * distinct in a UNIQUE index, so this key would not dedupe it — its guard
 * would have to live at the call site.
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

/**
 * The runner's notifications, newest first, each saying whether Mark all
 * read would clear it: unread, and not a verdict still owed. The screen
 * offers the button only when some row is `markable`, so a runner whose
 * one unread row is an owed reminder is not handed a button that does
 * nothing (PR #102 review). The predicate is mark-all's own, in SQL, so
 * the two cannot disagree.
 */
export async function listNotifications(db: NotificationsDb, userId: string) {
  const markable = and(eq(notifications.read, false), notOwed(db, userId));
  return db
    .select({
      ...getTableColumns(notifications),
      markable: sql<number>`coalesce(${markable}, 0)`.mapWith(Boolean),
    })
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
 * The runs this runner still owes a verdict, as a subquery for Mark all
 * read: no outfit entry, or one whose verdict is empty, **at any age**.
 *
 * This is `runsAwaitingVerdict`'s set (modules/runs owns the definition,
 * round 22 item 18) written as SQL a `notInArray` can hold, because that
 * function answers rows and a statement cannot be built from a Promise.
 * It cannot import it either: runs imports this module, so the reverse is
 * a cycle. `test/notifications.test.ts` pins the two to the same set.
 *
 * One LEFT JOIN answers both halves — a run with no entry joins to NULLs,
 * so `verdict IS NULL` is true of it and of an entry nobody judged.
 * Index-backed on both sides: `runs_user_started` leads with the user, and
 * the UNIQUE `entries_run` is the probe.
 */
function owedRuns(db: NotificationsDb, userId: string) {
  return db
    .select({ id: runs.id })
    .from(runs)
    .leftJoin(outfitEntries, eq(outfitEntries.runId, runs.id))
    .where(and(eq(runs.userId, userId), isNull(outfitEntries.verdict)));
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
 * otherwise a **dot** for anything unread.
 */
export interface BellState {
  unreadCount: number;
  verdictsWaiting: number;
}

/**
 * Reads the runs awaiting a verdict, oldest first, at most `limit` of them
 * — `runsAwaitingVerdict` from modules/runs, bound to this runner by the
 * server function. Handed in rather than imported, because runs imports
 * this module and the reverse would be a cycle.
 */
export type AwaitingVerdict = (limit: number) => Promise<readonly unknown[]>;

/**
 * The bell's two counts. **Its number is the one awaiting set, at any
 * age** (owner, 2026-09-24: DS2's backlog and the bell are the same set),
 * so a run from last month that never got its verdict still counts.
 *
 * The number stops at `9+`, so the set is read one past the cap and no
 * further: ten rows say "more than nine" as well as ten thousand would,
 * and D1 bills the rows it reads.
 */
export async function bellState(
  db: NotificationsDb,
  userId: string,
  awaiting: AwaitingVerdict,
): Promise<BellState> {
  const [unreadCount, owed] = await Promise.all([
    unreadNotificationCount(db, userId),
    awaiting(BELL_NUMBER_CAP + 1),
  ]);
  return { unreadCount, verdictsWaiting: owed.length };
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
): Promise<void> {
  await db
    .update(notifications)
    .set({ read: true })
    .where(and(unreadOf(userId), notOwed(db, userId)));
}

/**
 * A notification that is not a verdict still owed: any kind but a kit
 * reminder, or a kit reminder whose run has its verdict. What Mark all
 * read may clear, and what the list calls markable.
 */
function notOwed(db: NotificationsDb, userId: string) {
  return or(
    ne(notifications.kind, "kit_reminder"),
    notInArray(notifications.subjectId, owedRuns(db, userId)),
  );
}
