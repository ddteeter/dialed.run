import { and, eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";

import {
  imports,
  notifications,
  processedWebhookEvents,
  runs,
  stravaConnections,
} from "../../src/db/schema-core";
import { env } from "../../src/env";
import { newUlid } from "../../src/lib/ids";
import { nowSeconds } from "../../src/lib/now";
import { handleImportsBatch } from "../../src/modules/runs/consumer";
import { coreDb } from "../../src/modules/runs/core-db";
import {
  REMINDER_MATCH_WINDOW_S,
  clearMatchingReminder,
  hasMatchingUpload,
} from "../../src/modules/runs/strava/reminder-match";
import { batchOf, fakeMessage } from "../queue-fakes";
import validTcx from "./fixtures/valid.tcx?raw";

/**
 * Round 25: one Strava reminder per run, cleared when that run's file is
 * uploaded — matched on when the run landed on Strava, since the start
 * time is activity data we never see.
 */

const HOUR = 60 * 60;
// valid.tcx starts 2026-08-15T12:00:00Z and lasts 1800 s.
const TCX_ENDED_AT = Math.floor(Date.UTC(2026, 7, 15, 12, 30) / 1000);

function nothing(): void {
  /*
   * Errors are not what these tests are about; each asserts on rows.
   */
}

async function deliver(body: unknown): Promise<void> {
  const job = fakeMessage(newUlid(), body);
  await handleImportsBatch(batchOf("dialed-imports", [job]), {
    db: coreDb(),
    importBucket: env.IMPORTS,
    captureException: nothing,
  });
}

async function seedReminder(
  userId: string,
  createdAt: number,
  overrides: { kind?: string; read?: boolean } = {},
): Promise<string> {
  const id = newUlid();
  await coreDb()
    .insert(notifications)
    .values({
      id,
      userId,
      kind: overrides.kind ?? "strava_reminder",
      subjectId: newUlid(),
      body: "New run on Strava",
      read: overrides.read ?? false,
      createdAt,
    });
  return id;
}

async function isRead(id: string): Promise<boolean | undefined> {
  const [row] = await coreDb()
    .select({ read: notifications.read })
    .from(notifications)
    .where(eq(notifications.id, id));
  return row?.read;
}

async function seedFileRun(
  userId: string,
  endedAt: number,
  durationS: number,
  source: "file" | "manual" = "file",
): Promise<void> {
  await coreDb()
    .insert(runs)
    .values({
      id: newUlid(),
      userId,
      source,
      startedAt: endedAt - durationS,
      durationS,
      distanceM: 5000,
      indoor: true,
      title: "Seeded",
      weatherStatus: "none",
    });
}

async function importTcx(userId: string): Promise<void> {
  const importId = newUlid();
  const r2Key = `imports/${userId}/${importId}.tcx`;
  await env.IMPORTS.put(r2Key, new TextEncoder().encode(validTcx));
  await coreDb().insert(imports).values({
    id: importId,
    userId,
    r2Key,
    status: "pending",
    createdAt: nowSeconds(),
  });
  await deliver({ type: "import", importId });
}

describe("an upload clears the reminder its run left", () => {
  it("marks the reminder read when the run's file is imported", async () => {
    const userId = newUlid();
    const reminder = await seedReminder(userId, TCX_ENDED_AT + HOUR);

    await importTcx(userId);

    expect(await isRead(reminder)).toBe(true);
  });

  it("leaves a reminder that landed before the run ended, or too long after", async () => {
    const userId = newUlid();
    const before = await seedReminder(userId, TCX_ENDED_AT - 60);
    const tooLate = await seedReminder(
      userId,
      TCX_ENDED_AT + REMINDER_MATCH_WINDOW_S + 60,
    );

    await importTcx(userId);

    expect(await isRead(before)).toBe(false);
    expect(await isRead(tooLate)).toBe(false);
  });
});

describe("clearMatchingReminder", () => {
  it("clears only the oldest unread match, and only this runner's", async () => {
    const userId = newUlid();
    const endedAt = 1_800_000_000;
    const newer = await seedReminder(userId, endedAt + 2 * HOUR);
    const oldest = await seedReminder(userId, endedAt + HOUR);
    const alreadyRead = await seedReminder(userId, endedAt + 30, {
      read: true,
    });
    const otherKind = await seedReminder(userId, endedAt + 10, {
      kind: "kit_reminder",
    });
    const someoneElse = await seedReminder(newUlid(), endedAt + 10);

    await clearMatchingReminder(coreDb(), userId, endedAt);

    expect(await isRead(oldest)).toBe(true);
    expect(await isRead(newer)).toBe(false);
    expect(await isRead(alreadyRead)).toBe(true);
    expect(await isRead(otherKind)).toBe(false);
    expect(await isRead(someoneElse)).toBe(false);
  });

  it("takes both edges of the window", async () => {
    const userId = newUlid();
    const endedAt = 1_800_100_000;
    const atEnd = await seedReminder(userId, endedAt);
    await clearMatchingReminder(coreDb(), userId, endedAt);
    expect(await isRead(atEnd)).toBe(true);

    const atEdge = await seedReminder(
      userId,
      endedAt + REMINDER_MATCH_WINDOW_S,
    );
    await clearMatchingReminder(coreDb(), userId, endedAt);
    expect(await isRead(atEdge)).toBe(true);
  });

  it("is twelve hours wide", () => {
    expect(REMINDER_MATCH_WINDOW_S).toBe(12 * HOUR);
  });
});

async function connect(userId: string): Promise<string> {
  const athleteId = newUlid();
  await coreDb()
    .insert(stravaConnections)
    .values({
      userId,
      athleteId,
      accessToken: "access",
      refreshToken: "refresh",
      expiresAt: nowSeconds() + HOUR,
      status: "ok",
    });
  return athleteId;
}

async function reminders(userId: string) {
  return coreDb()
    .select()
    .from(notifications)
    .where(
      and(
        eq(notifications.userId, userId),
        eq(notifications.kind, "strava_reminder"),
      ),
    );
}

describe("a reminder for a run already uploaded is not written", () => {
  it("claims the event and writes no row when the file is already in", async () => {
    const userId = newUlid();
    const athleteId = await connect(userId);
    const landedAt = 1_800_200_000;
    await seedFileRun(userId, landedAt - HOUR, 3000);
    const objectId = newUlid();

    await deliver({
      type: "strava_reminder",
      athleteId,
      objectId,
      aspectType: "create",
      eventTime: landedAt,
    });

    expect(await reminders(userId)).toStrictEqual([]);
    const claimed = await coreDb()
      .select()
      .from(processedWebhookEvents)
      .where(eq(processedWebhookEvents.objectId, objectId));
    expect(claimed).toHaveLength(1);
  });

  it("still writes the reminder when the only upload is a different run", async () => {
    const userId = newUlid();
    const athleteId = await connect(userId);
    const landedAt = 1_800_300_000;
    // Ended too long before, and a hand-entered run in the window.
    await seedFileRun(userId, landedAt - REMINDER_MATCH_WINDOW_S - 60, 3000);
    await seedFileRun(userId, landedAt - HOUR, 3000, "manual");

    await deliver({
      type: "strava_reminder",
      athleteId,
      objectId: newUlid(),
      aspectType: "create",
      eventTime: landedAt,
    });

    expect(await reminders(userId)).toHaveLength(1);
  });
});

describe("hasMatchingUpload", () => {
  it("finds a long run that ended at the window's early edge", async () => {
    // Started well before the window opened; what matters is its end.
    const userId = newUlid();
    const landedAt = 1_800_400_000;
    await seedFileRun(userId, landedAt - REMINDER_MATCH_WINDOW_S, 5 * HOUR);

    expect(await hasMatchingUpload(coreDb(), userId, landedAt)).toBe(true);
  });

  it("finds a run that ended as the reminder landed, and none that ended after", async () => {
    const userId = newUlid();
    const landedAt = 1_800_500_000;
    await seedFileRun(userId, landedAt + 60, 1800);
    expect(await hasMatchingUpload(coreDb(), userId, landedAt)).toBe(false);

    await seedFileRun(userId, landedAt, 1800);
    expect(await hasMatchingUpload(coreDb(), userId, landedAt)).toBe(true);
  });

  it("finds nothing for another runner's upload", async () => {
    const landedAt = 1_800_600_000;
    await seedFileRun(newUlid(), landedAt - HOUR, 1800);

    expect(await hasMatchingUpload(coreDb(), newUlid(), landedAt)).toBe(false);
  });
});
