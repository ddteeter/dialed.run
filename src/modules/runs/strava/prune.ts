/**
 * Strava's cache rule, applied to the only Strava data we keep (STR-10).
 *
 * API Policy §6.2: "You may not retain Strava Data in your cache for
 * longer than seven (7) days." We never store an activity, but three
 * places hold an activity **id**: the webhook dedupe table, a reminder's
 * `subject_id`, and a dead-lettered reminder's Gave up row, whose subject
 * is the job (`reminderSubject`). Whether a bare id is "Strava Data" is
 * arguable; pruning it is cheap, so it goes (production-readiness audit
 * §1.6).
 *
 * **The dedupe window survives it.** Strava retries a push it did not get a
 * 200 for "up to a total of three attempts", within minutes of the event
 * (developers.strava.com/docs/webhooks); nothing redelivers a week-old
 * event. So a key only has to outlive the retries, and seven days is
 * orders of magnitude more than that.
 *
 * Runs from the daily digest's firing (`modules/ops/scheduled.ts`) — no
 * cron of its own. Every statement is re-runnable (law 1): a second pass
 * finds nothing older than the cutoff left to change.
 */
import { and, eq, isNotNull, lt } from "drizzle-orm";

import { gaveUpClearBefore } from "../../../db/gave-up";
import {
  notifications,
  processedWebhookEvents,
  reminderEmailDays,
} from "../../../db/schema-core";
import { nowSeconds } from "../../../lib/now";
import { orSqlNull } from "../../../lib/sql/sql-null";
import type { CoreDb } from "../core-db";

const SEVEN_DAYS_S = 7 * 24 * 60 * 60;

/**
 * Delete the dedupe keys, and forget which activity each reminder was for,
 * once they are seven days old.
 *
 * A reminder row itself stays: it is the runner's own notification, its
 * body carries no Strava data, and its time is when the run landed. Only
 * the subject goes. So does a dead-lettered reminder's Gave up row
 * (R-142's follow-up), and the record of which days a reminder email went. The statements are independent — none records or
 * authorises another — but they are one policy, so they are one batch,
 * and a failure leaves all of them for tomorrow rather than some.
 *
 * Every filter is index-backed (`add_strava_prune_indexes`, owner
 * approved 2026-09-26): `notifications_kind_created`,
 * `webhook_events_time` and Gave up's own index, so the prune reads what
 * it changes rather than whole tables. `test/runs/strava-prune.test.ts` holds the query plans.
 */
export async function pruneStravaIds(db: CoreDb): Promise<void> {
  const cutoff = nowSeconds() - SEVEN_DAYS_S;
  const agedReminder = and(
    eq(notifications.kind, "strava_reminder"),
    isNotNull(notifications.subjectId),
    lt(notifications.createdAt, cutoff),
  );
  await db.batch([
    db
      .delete(processedWebhookEvents)
      .where(lt(processedWebhookEvents.eventTime, cutoff)),
    db
      .update(notifications)
      .set({ subjectId: orSqlNull(undefined) })
      .where(agedReminder),
    // A dead-lettered reminder's Gave up row names the activity in its
    // subject, so it goes once its last failure is a week old.
    gaveUpClearBefore(db, "reminder", cutoff),
    // The days a reminder email went (design 140): nothing reads past
    // yesterday, so a week-old one is only a record of a runner's runs.
    db.delete(reminderEmailDays).where(lt(reminderEmailDays.sentAt, cutoff)),
  ]);
}
