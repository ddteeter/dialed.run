/**
 * The Strava reminder's email (task 127 · STR-9; decision D-43; round 26
 * #19; design 140): owed in the batch that writes the bell row, sent 20
 * minutes after the run landed, at most one a day.
 *
 * **One a day is decided here, not by the outbox key alone.** The key is
 * per runner per local day, which folds two first reminders racing into
 * one row. It cannot stop a second email on its own: once a row is sent
 * the drain deletes it, and a later debt with the same key is a fresh row.
 * So only the runner's first reminder of their day owes the email, read
 * from the bell rows before the batch; a later reminder that day owes
 * nothing.
 *
 * **The next day's email counts both.** Yesterday's email covered its
 * first reminder only, so today's first counts itself and yesterday's later
 * reminders still unread — which is why the drawn body for more than one
 * run says "yesterday and today".
 *
 * **Skipped by send time** through the debt's `unlessRead`: an upload pairs
 * and reads the reminder (`pairWithReminder`), and the drain then sends
 * nothing. The runner's switch and a confirmed address are the sender's
 * own checks, also at send time.
 *
 * **No activity data** (D-33): a clock label, a count and our own
 * notification id. No Strava id rides the outbox.
 */
import { and, asc, desc, eq, exists, gte, isNotNull } from "drizzle-orm";

import {
  notifications,
  runs,
  stravaConnections,
} from "../../../db/schema-core";
import {
  calendarDay,
  clockLabel,
  previousCalendarDay,
} from "../../../lib/dates";
import { ulidSchema } from "../../../lib/ids";
import { hasRowWhere } from "../../../lib/sql/keyed-read";
import type { OutboxMessage } from "../../../lib/sql/outbox";
import { emailDebt } from "../../email";
import { observationsForRuns } from "../../weather";
import type { CoreDb } from "../core-db";

/**
How long after the run lands its email is held (round 26 #19).
*/
export const REMINDER_EMAIL_DELAY_S = 20 * 60;

const DAY_S = 24 * 60 * 60;

/**
 * A bell row the decision reads: one of the runner's earlier Strava
 * reminders.
 */
export interface EarlierReminder {
  readonly createdAt: number;
  readonly read: boolean;
}

/**
 * The runner's Strava reminders since the start of yesterday, oldest
 * first. Three days back covers all of yesterday in any zone, even late on
 * a 25-hour day after a 25-hour day. Grouped by
 * day in code, because the day is the runner's and SQLite has no zones.
 * On `notifications_dedupe`, which leads with the runner and the kind.
 */
export async function earlierReminders(
  db: CoreDb,
  userId: string,
  landedAt: number,
): Promise<EarlierReminder[]> {
  return db
    .select({
      createdAt: notifications.createdAt,
      read: notifications.read,
    })
    .from(notifications)
    .where(
      and(
        eq(notifications.userId, userId),
        eq(notifications.kind, "strava_reminder"),
        gte(notifications.createdAt, landedAt - 3 * DAY_S),
      ),
    )
    .orderBy(asc(notifications.createdAt), asc(notifications.id));
}

/**
What the decision is told about the reminder now landing.
*/
export interface Landing {
  readonly userId: string;
  /**
  The bell row being written for it, which the email repeats.
  */
  readonly notificationId: string;
  readonly at: number;
  /**
  The runner's zone, for their day and their clock; UTC when unknown.
  */
  readonly zone: string | undefined;
}

/**
 * The email this reminder owes, or none when the runner already had a
 * reminder today: that one owed today's email. A redelivered event never
 * gets here — the consumer stops at its claim.
 */
export function owedReminderEmail(
  earlier: readonly EarlierReminder[],
  landing: Landing,
): { readonly message: OutboxMessage; readonly notBefore: number } | undefined {
  const dayOf = (at: number) => calendarDay(at, landing.zone);
  const today = dayOf(landing.at);
  if (earlier.some((row) => dayOf(row.createdAt) === today)) return undefined;
  const yesterday = previousCalendarDay(landing.at, landing.zone);
  // The first of yesterday's owed yesterday's email; the rest owed none.
  const [, ...uncovered] = earlier.filter(
    (row) => dayOf(row.createdAt) === yesterday,
  );
  const carried = uncovered.filter((row) => !row.read).length;
  return {
    message: emailDebt(
      {
        to: { userId: landing.userId },
        template: {
          kind: "run_reminder",
          landedAt: clockLabel(landing.at, landing.zone),
          runs: 1 + carried,
        },
      },
      {
        dedupeKey: `run_reminder:${landing.userId}:${today}`,
        unlessRead: landing.notificationId,
      },
    ),
    notBefore: landing.at + REMINDER_EMAIL_DELAY_S,
  };
}

/**
 * How many of the runner's latest located runs are asked for a zone. A
 * run's zone comes from its observation, which an indoor run or one whose
 * weather never arrived lacks, so one run is not always enough.
 */
const ZONE_RUNS = 5;

/**
 * The runner's zone, as best the app knows it: nothing stores one (see
 * `closet/components/use-runner-zone.ts`), so it is the zone of their
 * latest run whose observation named one, or `undefined` (UTC).
 *
 * Two databases, so assembled in code: the runs are core's, the zones the
 * weather cache's (CLAUDE.md's one exception to filtering in SQL). On
 * `runs_user_started`.
 */
export async function runnerZone(
  db: CoreDb,
  userId: string,
): Promise<string | undefined> {
  const located = await latestLocatedRuns(db, userId);
  const ids = located.map((run) => ulidSchema.parse(run.id));
  const observed = await observationsForRuns(ids);
  return ids
    .map((id) => observed.get(id)?.timeZone)
    .find((zone) => zone !== undefined);
}

/**
The runner's latest runs that have a place, newest first.
*/
function latestLocatedRuns(db: CoreDb, userId: string) {
  return db
    .select({ id: runs.id })
    .from(runs)
    .where(and(eq(runs.userId, userId), isNotNull(runs.lat)))
    .orderBy(desc(runs.startedAt))
    .limit(ZONE_RUNS);
}

/**
 * Whether a reminder's email may still go, asked when it is due (design
 * 140): its bell row is there and unread — an upload pairs and reads it —
 * and the runner is still connected to Strava, so a disconnect inside the
 * 20 minutes stops it as it stops the reminders themselves. One read, on
 * the bell row's primary key and `strava_connections`'.
 */
export async function isReminderStillOwed(
  // Any dialed-core handle: the outbox's drain asks with its own.
  db: Parameters<typeof hasRowWhere>[0],
  notificationId: string,
): Promise<boolean> {
  const stillConnected = db
    .select({ userId: stravaConnections.userId })
    .from(stravaConnections)
    .where(eq(stravaConnections.userId, notifications.userId));
  return await hasRowWhere(
    db,
    notifications,
    notifications.id,
    and(
      eq(notifications.id, notificationId),
      eq(notifications.read, false),
      exists(stillConnected),
    ),
  );
}
