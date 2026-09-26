import { and, eq, isNotNull, lt } from "drizzle-orm";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  notifications,
  processedWebhookEvents,
} from "../../src/db/schema-core";
import { env } from "../../src/env";
import { newUlid } from "../../src/lib/ids";
import { nowSeconds } from "../../src/lib/now";
import { handleScheduled } from "../../src/modules/ops";
import { coreDb } from "../../src/modules/runs/core-db";
import { pruneStravaIds } from "../../src/modules/runs";

/**
 * STR-10: Strava's seven-day cache rule (API Policy §6.2), on the activity
 * ids we hold — the webhook dedupe keys and a reminder's subject — run
 * from the daily digest's firing.
 */

const DAY = 24 * 60 * 60;
const DIGEST = { cron: "0 12 * * *" } as ScheduledController;

function nothing(): void {
  /*
   * The point is to do nothing.
   */
}

afterEach(() => {
  vi.unstubAllGlobals();
});

async function seedEvent(objectId: string, eventTime: number): Promise<void> {
  await coreDb()
    .insert(processedWebhookEvents)
    .values({ objectId, aspectType: "create", eventTime });
}

async function eventsFor(objectId: string) {
  return coreDb()
    .select()
    .from(processedWebhookEvents)
    .where(eq(processedWebhookEvents.objectId, objectId));
}

async function seedNotification(
  userId: string,
  kind: string,
  subjectId: string,
  createdAt: number,
): Promise<void> {
  await coreDb().insert(notifications).values({
    id: newUlid(),
    userId,
    kind,
    subjectId,
    body: "New run on Strava",
    createdAt,
  });
}

async function subjectsOf(userId: string, kind: string) {
  const rows = await coreDb()
    .select({ subjectId: notifications.subjectId })
    .from(notifications)
    .where(and(eq(notifications.userId, userId), eq(notifications.kind, kind)));
  return rows.map((row) => row.subjectId);
}

describe("pruneStravaIds", () => {
  it("deletes dedupe keys older than seven days and keeps the rest", async () => {
    const now = nowSeconds();
    const old = newUlid();
    const recent = newUlid();
    const edge = newUlid();
    await seedEvent(old, now - 8 * DAY);
    await seedEvent(recent, now - 6 * DAY);
    // A second inside the window is still inside it.
    await seedEvent(edge, now - 7 * DAY + 60);

    await pruneStravaIds(coreDb());

    expect(await eventsFor(old)).toStrictEqual([]);
    expect(await eventsFor(recent)).toHaveLength(1);
    expect(await eventsFor(edge)).toHaveLength(1);
  });

  it("forgets an old reminder's activity id, and keeps the reminder", async () => {
    const now = nowSeconds();
    const userId = newUlid();
    await seedNotification(userId, "strava_reminder", "111", now - 8 * DAY);
    await seedNotification(userId, "strava_reminder", "222", now - DAY);

    await pruneStravaIds(coreDb());

    const subjects = await subjectsOf(userId, "strava_reminder");
    expect(subjects).toHaveLength(2);
    expect(subjects).toContain("222");
    expect(subjects).not.toContain("111");
    // The old one's subject is gone — SQL NULL, not some other string.
    expect(
      subjects.filter((subject) => typeof subject !== "string"),
    ).toHaveLength(1);
  });

  it("touches no other kind's subject, however old", async () => {
    const now = nowSeconds();
    const userId = newUlid();
    const runId = newUlid();
    await seedNotification(userId, "kit_reminder", runId, now - 30 * DAY);

    await pruneStravaIds(coreDb());

    expect(await subjectsOf(userId, "kit_reminder")).toStrictEqual([runId]);
  });
});

describe("the daily digest runs the prune (the production call site)", () => {
  it("prunes old Strava ids when the digest fires", async () => {
    // The digest reports anomalies through Sentry's disabled-DSN console
    // line; silenced here, it is not what this test is about.
    vi.stubGlobal("console", { ...globalThis.console, error: nothing });
    const now = nowSeconds();
    const old = newUlid();
    await seedEvent(old, now - 10 * DAY);

    await handleScheduled(DIGEST);

    expect(await eventsFor(old)).toStrictEqual([]);
  });
});

async function planOf(sql: string, params: unknown[]): Promise<string> {
  const plan = await env.DIALED_CORE.prepare(`EXPLAIN QUERY PLAN ${sql}`)
    .bind(...params)
    .all<{ detail: string }>();
  return plan.results.map((row) => row.detail).join("\n");
}

describe("the prune reads by index, not by scanning (D1 bills rows scanned)", () => {
  it("finds old dedupe keys and old reminders through their indexes", async () => {
    const db = coreDb();
    const cutoff = 1_700_000_000;
    const keys = db
      .delete(processedWebhookEvents)
      .where(lt(processedWebhookEvents.eventTime, cutoff))
      .toSQL();
    const reminders = db
      .update(notifications)
      .set({ read: true })
      .where(
        and(
          eq(notifications.kind, "strava_reminder"),
          isNotNull(notifications.subjectId),
          lt(notifications.createdAt, cutoff),
        ),
      )
      .toSQL();

    const keysPlan = await planOf(keys.sql, keys.params);
    const remindersPlan = await planOf(reminders.sql, reminders.params);

    expect(keysPlan).toMatch(/webhook_events_time/u);
    expect(keysPlan).not.toMatch(/SCAN\s+processed_webhook_events/iu);
    expect(remindersPlan).toMatch(/notifications_kind_created/u);
    expect(remindersPlan).not.toMatch(/SCAN\s+notifications/iu);
  });
});
