/**
 * "One reminder per run, cleared when a file with a matching start time is
 * uploaded" (design round 25, "Strava reminds. You upload.").
 *
 * **We cannot match on start time, so we match on when the run landed.**
 * The webhook carries an activity id and the moment Strava received the
 * activity, and nothing else; the start time lives in the activity, which
 * we never fetch (D-33, API Policy §5.3). A watch syncs to Strava after the
 * run ends, so a reminder and an uploaded file are the same run when the
 * reminder landed after the file's run ended, and not long after.
 *
 * "Not long" is twelve hours: long enough for a watch that syncs at the
 * end of the day, short enough that yesterday morning's upload does not
 * swallow tonight's reminder. It is a guess the owner can move, and it is
 * written once, here, for both directions:
 *
 * - a file uploaded after its reminder marks that reminder read;
 * - a reminder that lands after its file was uploaded is not written.
 */
import { and, asc, eq, gte, inArray, lte, sql } from "drizzle-orm";

import { notifications, runs } from "../../../db/schema-core";
import { hasRowWhere } from "../../../lib/keyed-read";
import type { CoreDb } from "../core-db";

export const REMINDER_MATCH_WINDOW_S = 12 * 60 * 60;

/**
 * The statement that clears the reminder an uploaded run answers: the
 * oldest unread `strava_reminder` that landed within the window after the
 * run ended. A statement rather than an awaited call, so the import can
 * write it in the same batch as the run it belongs to.
 *
 * Marked read, not deleted: the row is also the only trace of when a run
 * last landed, which T3a's "LAST RUN SEEN" reads.
 */
export function clearMatchingReminder(
  db: CoreDb,
  userId: string,
  runEndedAt: number,
) {
  const oldestMatch = db
    .select({ id: notifications.id })
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
    .orderBy(asc(notifications.createdAt))
    .limit(1);
  return db
    .update(notifications)
    .set({ read: true })
    .where(inArray(notifications.id, oldestMatch));
}

/**
 * How long before the window a matching run may have started. Nothing
 * caps a run's duration, so this is what keeps the read below on a short
 * stretch of `runs_user_started` rather than a runner's whole history: a
 * run longer than two days is not one a reminder is about.
 */
const MAX_RUN_S = 48 * 60 * 60;

/**
 * When a run ended, in SQL.
 */
function sqlEnd() {
  return sql`${runs.startedAt} + ${runs.durationS}`;
}

/**
 * Whether this runner already uploaded the file a reminder landing at
 * `landedAt` would be about — a file run that ended within the window
 * before it.
 */
export async function hasMatchingUpload(
  db: CoreDb,
  userId: string,
  landedAt: number,
): Promise<boolean> {
  const earliestEnd = landedAt - REMINDER_MATCH_WINDOW_S;
  const ended = sqlEnd();
  const endedInWindow = and(gte(ended, earliestEnd), lte(ended, landedAt));
  return hasRowWhere(
    db,
    runs,
    runs.id,
    and(
      eq(runs.userId, userId),
      eq(runs.source, "file"),
      lte(runs.startedAt, landedAt),
      gte(runs.startedAt, earliestEnd - MAX_RUN_S),
      endedInWindow,
    ),
  );
}
