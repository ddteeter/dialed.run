/**
 * The Strava reminder's email (task 127 · STR-9; decision D-43; round 26
 * #19; design 140): owed in the batch that writes the bell row, sent 20
 * minutes after the run landed, at most one a day.
 *
 * **One a day is a record of what was sent** (`reminder_email_days`, owner
 * 2026-10-12). A reminder owes the email unless today's has already gone,
 * and the email itself goes only if today's has not — the day is marked in
 * the batch that marks the outbox row sent. So a first email skipped by an
 * upload leaves the day open for the next run, and two debts for one day
 * cannot both send. The outbox key is per runner per day too, which folds
 * two reminders landing at once into one row.
 *
 * **The next day's email counts both.** Yesterday's email covered what it
 * said: the reminders up to the landing that owed it, because a second
 * debt that day takes the row over and leaves its payload as it was.
 * Today's counts itself and yesterday's later ones still unread — all of
 * yesterday's unread, if none went — which is why the drawn body for more
 * than one run says "yesterday and today".
 *
 * **Skipped by send time** when no reminder from that landing on is still
 * unread (an upload pairs and reads its own — and so does Mark all read,
 * which the owner kept, 2026-10-12), when the runner has disconnected
 * Strava, or when the day's email went. Any of them, not the first: an
 * upload for the first run must not silence the email a second run that
 * day still owes.
 * The runner's switch and a confirmed address are the sender's own checks,
 * also at send time.
 *
 * **No activity data** (D-33): a clock label, a count, our own ids and the
 * runner's day. No Strava id rides the outbox.
 */
import {
  and,
  asc,
  desc,
  eq,
  exists,
  inArray,
  isNotNull,
  notExists,
  sql,
} from "drizzle-orm";

import {
  notifications,
  reminderEmailDays,
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
import type { OutboxMessage, ReminderEmailRef } from "../../../lib/sql/outbox";
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
 * A day a reminder email went, and what it covered: the landing of the
 * reminder that owed it. The column is `covered_until`, and holds that
 * landing rather than the send, because the next day's count needs what
 * the email said and the send happens 20 minutes or more later.
 */
export interface EmailedDay {
  readonly day: string;
  readonly coveredUntil: number;
}

/**
 * The runner's emailed-day rows among these days, on
 * `reminder_email_days_user_day`.
 */
function emailedOn(userId: string, days: readonly string[]) {
  return and(
    eq(reminderEmailDays.userId, userId),
    inArray(reminderEmailDays.day, [...days]),
  );
}

/**
 * The runner's Strava reminders from `at` on, on `notifications_dedupe`
 * (runner, kind).
 *
 * The time is compared through a unary `+`, which keeps its value and
 * stops SQLite from serving it from an index: left bare, the planner takes
 * the prune's `notifications_kind_created` (kind, created_at) instead,
 * which reads every runner's reminders since `at` to find this one's
 * (`test/runs/reminder-email.test.ts` holds the plan).
 */
export function remindersSince(userId: string, at: number) {
  return and(
    eq(notifications.userId, userId),
    eq(notifications.kind, "strava_reminder"),
    sql`+${notifications.createdAt} >= ${at}`,
  );
}

/**
 * What the decision reads, before the batch (a batch cannot branch): the
 * runner's Strava reminders since the start of yesterday, oldest first —
 * three days back covers all of yesterday in any zone, even late on a
 * 25-hour day after a 25-hour day — and the days among today and yesterday
 * that already had their email.
 *
 * Grouped by day in code, because the day is the runner's and SQLite has
 * no zones. The reminders on `notifications_dedupe` (`remindersSince`);
 * the days on `reminder_email_days_user_day`.
 */
export async function reminderHistory(
  db: CoreDb,
  userId: string,
  landing: Readonly<{ at: number; zone: string | undefined }>,
): Promise<{ earlier: EarlierReminder[]; emailed: EmailedDay[] }> {
  const days = [
    calendarDay(landing.at, landing.zone),
    previousCalendarDay(landing.at, landing.zone),
  ];
  const recentReminders = remindersSince(userId, landing.at - 3 * DAY_S);
  const [earlier, emailed] = await db.batch([
    db
      .select({ createdAt: notifications.createdAt, read: notifications.read })
      .from(notifications)
      .where(recentReminders)
      .orderBy(asc(notifications.createdAt), asc(notifications.id)),
    db
      .select({
        day: reminderEmailDays.day,
        coveredUntil: reminderEmailDays.coveredUntil,
      })
      .from(reminderEmailDays)
      .where(emailedOn(userId, days)),
  ]);
  return { earlier, emailed };
}

/**
What the decision is told about the reminder now landing.
*/
export interface Landing {
  readonly userId: string;
  /**
  When it lands: its bell row's `created_at`, which the email names.
  */
  readonly at: number;
  /**
  The runner's zone, for their day and their clock; UTC when unknown.
  */
  readonly zone: string | undefined;
}

/**
 * The email this reminder owes, or none when today's email already went.
 * A redelivered event never gets here — the consumer stops at its claim.
 */
export function owedReminderEmail(
  history: Readonly<{
    earlier: readonly EarlierReminder[];
    emailed: readonly EmailedDay[];
  }>,
  landing: Landing,
): { readonly message: OutboxMessage; readonly notBefore: number } | undefined {
  const today = calendarDay(landing.at, landing.zone);
  const yesterday = previousCalendarDay(landing.at, landing.zone);
  const coveredOn = (day: string) =>
    history.emailed.find((row) => row.day === day)?.coveredUntil;
  if (coveredOn(today) !== undefined) return undefined;
  // What yesterday's email covered: the reminders up to the landing that
  // owed it. With no email yesterday, none of them.
  const coveredUntil = coveredOn(yesterday) ?? 0;
  const carried = history.earlier.filter(
    (row) =>
      !row.read &&
      row.createdAt > coveredUntil &&
      calendarDay(row.createdAt, landing.zone) === yesterday,
  ).length;
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
        reminder: {
          userId: landing.userId,
          landedAt: landing.at,
          day: today,
        },
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
 * 140): some reminder of the runner's from the landing that owed it on is
 * still unread — an upload pairs and reads its own, so the first run's
 * file arriving leaves the email a second run owes — the runner is still
 * connected to Strava, so a disconnect inside the 20 minutes stops it as
 * it stops the reminders themselves, and the day's email has not gone.
 *
 * One read: the runner's unread reminders on a runner-led index (SQLite
 * takes `notifications_user_read` for the unread ones; see
 * `remindersSince`), and an EXISTS on each of `strava_connections` and
 * `reminder_email_days` (`test/runs/reminder-email.test.ts` holds the
 * plan).
 */
export async function isReminderStillOwed(
  // Any dialed-core handle: the outbox's drain asks with its own.
  db: Parameters<typeof hasRowWhere>[0],
  reminder: ReminderEmailRef,
): Promise<boolean> {
  return await hasRowWhere(
    db,
    notifications,
    notifications.id,
    stillOwedWhere(db, reminder),
  );
}

/**
 * `isReminderStillOwed`'s condition on `notifications`, apart so its plan
 * can be read.
 */
export function stillOwedWhere(
  db: Parameters<typeof hasRowWhere>[0],
  { userId, day, landedAt }: ReminderEmailRef,
) {
  const connected = db
    .select({ one: sql`1` })
    .from(stravaConnections)
    .where(eq(stravaConnections.userId, userId));
  const dayEmailed = db
    .select({ one: sql`1` })
    .from(reminderEmailDays)
    .where(emailedOn(userId, [day]));
  return and(
    remindersSince(userId, landedAt),
    eq(notifications.read, false),
    exists(connected),
    notExists(dayEmailed),
  );
}

/**
 * The day's email marked sent, as a statement for the batch that marks
 * the outbox row sent — so the two land together. It records what the
 * email covered, the landing that owed it (`EmailedDay`), not when it
 * went. A second mark for the same day (a send that raced past the
 * check) changes nothing.
 */
export function reminderEmailSent(
  db: Parameters<typeof hasRowWhere>[0],
  reminder: ReminderEmailRef,
) {
  return db
    .insert(reminderEmailDays)
    .values({
      userId: reminder.userId,
      day: reminder.day,
      coveredUntil: reminder.landedAt,
    })
    .onConflictDoNothing();
}
