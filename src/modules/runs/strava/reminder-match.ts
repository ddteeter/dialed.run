/**
 * "One reminder per run, cleared when a file with a matching start time is
 * uploaded" (design round 25, "Strava reminds. You upload.").
 *
 * **We cannot match on start time, so we match on when the run landed.**
 * The webhook carries an activity id and the moment Strava received the
 * activity, and nothing else; the start time lives in the activity, which
 * we never fetch (D-33, API Policy §5.3). A watch syncs to Strava after the
 * run ends, so a reminder and an uploaded file are the same run when the
 * reminder landed after the file's run ended, and not long after — twelve
 * hours, the owner's window (2026-09-26).
 *
 * **One upload clears one reminder** (owner, 2026-09-26). A file run is
 * paired with at most one reminder, and the pairing is recorded on the run
 * (`runs.reminder_matched_at`), so a run already paired can neither clear
 * nor suppress another. That is what keeps a morning run uploaded at 10:00
 * from swallowing the evening run's reminder at 18:00. Both directions:
 *
 * - a file uploaded after its reminder marks the oldest unpaired reminder
 *   in its window read, and is paired with it;
 * - a reminder landing after its file was uploaded is not written, and the
 *   oldest unpaired file run in its window is paired with it.
 */
import { and, asc, eq, gte, inArray, isNull, lte, sql } from "drizzle-orm";

import { notifications, runs } from "../../../db/schema-core";
import type { CoreDb } from "../core-db";

export const REMINDER_MATCH_WINDOW_S = 12 * 60 * 60;

/**
 * The oldest unread reminder that landed in a run's window, as a subquery
 * on one column.
 */
function oldestUnreadReminder(
  db: CoreDb,
  userId: string,
  runEndedAt: number,
  column: typeof notifications.id | typeof notifications.createdAt,
) {
  return db
    .select({ value: column })
    .from(notifications)
    .where(
      and(
        eq(notifications.userId, userId),
        eq(notifications.kind, "strava_reminder"),
        eq(notifications.read, false),
        gte(notifications.createdAt, runEndedAt),
        lte(notifications.createdAt, runEndedAt + REMINDER_MATCH_WINDOW_S),
      ),
    )
    .orderBy(asc(notifications.createdAt), asc(notifications.id))
    .limit(1);
}

/**
 * The two statements that pair a newly imported run with the reminder it
 * answers: record the pairing on the run, then mark that reminder read. As
 * statements rather than awaited calls, so the import writes them in the
 * same batch as `imports.status = 'done'`.
 *
 * In this order on purpose: both select the same oldest unread reminder,
 * and the second statement is what makes it read. With no reminder in the
 * window the run is left unpaired (the subquery is NULL) and nothing is
 * marked.
 *
 * Marked read, not deleted: the row is also the only trace of when a run
 * last landed, which T3a's "LAST RUN SEEN" reads.
 */
export function pairWithReminder(
  db: CoreDb,
  userId: string,
  runId: string,
  runEndedAt: number,
) {
  return {
    pairRun: db
      .update(runs)
      .set({
        reminderMatchedAt: sql`(${oldestUnreadReminder(db, userId, runEndedAt, notifications.createdAt)})`,
      })
      .where(eq(runs.id, runId)),
    markRead: db
      .update(notifications)
      .set({ read: true })
      .where(
        inArray(
          notifications.id,
          oldestUnreadReminder(db, userId, runEndedAt, notifications.id),
        ),
      ),
  };
}

/**
 * How long before the window a matching run may have started. Nothing
 * caps a run's duration, so this is what keeps the read below on a short
 * stretch of `runs_user_started` rather than a runner's whole history: a
 * run longer than two days is not one a reminder is about.
 */
const MAX_RUN_S = 48 * 60 * 60;

/**
 * The file run a reminder landing at `landedAt` would be about, when this
 * runner already uploaded it: the oldest file run, not yet paired, that
 * ended within the window before the reminder landed.
 */
export async function unpairedUploadFor(
  db: CoreDb,
  userId: string,
  landedAt: number,
): Promise<string | undefined> {
  const earliestEnd = landedAt - REMINDER_MATCH_WINDOW_S;
  const ended = sql`${runs.startedAt} + ${runs.durationS}`;
  const endedInWindow = and(gte(ended, earliestEnd), lte(ended, landedAt));
  const [oldest] = await db
    .select({ id: runs.id })
    .from(runs)
    .where(
      and(
        eq(runs.userId, userId),
        eq(runs.source, "file"),
        isNull(runs.reminderMatchedAt),
        lte(runs.startedAt, landedAt),
        gte(runs.startedAt, earliestEnd - MAX_RUN_S),
        endedInWindow,
      ),
    )
    .orderBy(asc(runs.startedAt))
    .limit(1);
  return oldest?.id;
}

/**
 * Pair a file run with a reminder that arrived after it — the statement,
 * for the reminder's claim batch. Guarded on the run still being unpaired,
 * so two reminders racing for one run pair it once.
 */
export function pairRunWith(db: CoreDb, runId: string, landedAt: number) {
  return db
    .update(runs)
    .set({ reminderMatchedAt: landedAt })
    .where(and(eq(runs.id, runId), isNull(runs.reminderMatchedAt)));
}
