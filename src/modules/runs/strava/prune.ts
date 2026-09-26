/**
 * Strava's cache rule, applied to the only Strava data we keep (STR-10).
 *
 * API Policy §6.2: "You may not retain Strava Data in your cache for
 * longer than seven (7) days." We never store an activity, but two places
 * hold an activity **id**: the webhook dedupe table and a reminder's
 * `subject_id`. Whether a bare id is "Strava Data" is arguable; pruning it
 * is cheap, so it goes (production-readiness audit §1.6).
 *
 * **The dedupe window survives it.** Strava retries a push it did not get a
 * 200 for "up to a total of three attempts", within minutes of the event
 * (developers.strava.com/docs/webhooks); nothing redelivers a week-old
 * event. So a key only has to outlive the retries, and seven days is
 * orders of magnitude more than that.
 *
 * Runs from the daily digest's firing (`modules/ops/scheduled.ts`) — no
 * cron of its own. Both statements are re-runnable (law 1): a second pass
 * finds nothing older than the cutoff left to change.
 */
import { and, eq, isNotNull, lt } from "drizzle-orm";

import { notifications, processedWebhookEvents } from "../../../db/schema-core";
import { nowSeconds } from "../../../lib/now";
import { orSqlNull } from "../../../lib/sql-null";
import type { CoreDb } from "../core-db";

const SEVEN_DAYS_S = 7 * 24 * 60 * 60;

/**
 * Delete the dedupe keys, and forget which activity each reminder was for,
 * once they are seven days old.
 *
 * A reminder row itself stays: it is the runner's own notification, its
 * body carries no Strava data, and its time is when the run landed. Only
 * the subject goes. The two statements are independent — neither records
 * or authorises the other — but they are one policy, so they are one
 * batch, and a failure leaves both for tomorrow rather than half.
 *
 * Both filters are table scans today: neither table has an index on its
 * time column, and adding one is a migration this lane was not given. The
 * dedupe table holds a week of events by construction, and the scan is
 * once a day. Recorded in the PR's register.
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
  ]);
}
