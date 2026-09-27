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
  pairRunWith,
  pairWithReminder,
  unpairedUploadFor,
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
): Promise<string> {
  const id = newUlid();
  await coreDb()
    .insert(runs)
    .values({
      id,
      userId,
      source,
      startedAt: endedAt - durationS,
      durationS,
      distanceM: 5000,
      indoor: true,
      title: "Seeded",
      weatherStatus: "none",
    });
  return id;
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

async function connect(userId: string): Promise<string> {
  const athleteId = newUlid();
  await coreDb().insert(stravaConnections).values({
    userId,
    athleteId,
    refreshToken: "refresh",
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

async function pairedAt(runId: string): Promise<number | null | undefined> {
  const [row] = await coreDb()
    .select({ at: runs.reminderMatchedAt })
    .from(runs)
    .where(eq(runs.id, runId));
  return row?.at;
}

async function landReminder(athleteId: string, landedAt: number) {
  await deliver({
    type: "strava_reminder",
    athleteId,
    objectId: newUlid(),
    aspectType: "create",
    eventTime: landedAt,
  });
}

describe("an upload clears the reminder its run left", () => {
  it("marks the reminder read when the run's file is imported, and pairs them", async () => {
    const userId = newUlid();
    const landed = TCX_ENDED_AT + HOUR;
    const reminder = await seedReminder(userId, landed);

    await importTcx(userId);

    expect(await isRead(reminder)).toBe(true);
    const [run] = await coreDb()
      .select({ at: runs.reminderMatchedAt })
      .from(runs)
      .where(eq(runs.userId, userId));
    expect(run?.at).toBe(landed);
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
    const [run] = await coreDb()
      .select({ at: runs.reminderMatchedAt })
      .from(runs)
      .where(eq(runs.userId, userId));
    expect(run?.at).toBeNull();
  });
});

describe("pairWithReminder: one upload clears one reminder", () => {
  it("clears only the oldest unread match, and only this runner's", async () => {
    const userId = newUlid();
    const endedAt = 1_800_000_000;
    const runId = await seedFileRun(userId, endedAt, 1800);
    const newer = await seedReminder(userId, endedAt + 2 * HOUR);
    const oldest = await seedReminder(userId, endedAt + HOUR);
    const alreadyRead = await seedReminder(userId, endedAt + 30, {
      read: true,
    });
    const otherKind = await seedReminder(userId, endedAt + 10, {
      kind: "kit_reminder",
    });
    const someoneElse = await seedReminder(newUlid(), endedAt + 10);

    const pairing = pairWithReminder(coreDb(), userId, runId, endedAt);
    await coreDb().batch([pairing.pairRun, pairing.markRead]);

    expect(await isRead(oldest)).toBe(true);
    expect(await pairedAt(runId)).toBe(endedAt + HOUR);
    expect(await isRead(newer)).toBe(false);
    expect(await isRead(alreadyRead)).toBe(true);
    expect(await isRead(otherKind)).toBe(false);
    expect(await isRead(someoneElse)).toBe(false);
  });

  it("takes both edges of the window", async () => {
    const userId = newUlid();
    const endedAt = 1_800_100_000;
    const first = await seedFileRun(userId, endedAt, 1800);
    const second = await seedFileRun(userId, endedAt, 1700);
    const atEnd = await seedReminder(userId, endedAt);
    const atEdge = await seedReminder(
      userId,
      endedAt + REMINDER_MATCH_WINDOW_S,
    );

    const one = pairWithReminder(coreDb(), userId, first, endedAt);
    await coreDb().batch([one.pairRun, one.markRead]);
    expect(await isRead(atEnd)).toBe(true);
    expect(await isRead(atEdge)).toBe(false);

    const two = pairWithReminder(coreDb(), userId, second, endedAt);
    await coreDb().batch([two.pairRun, two.markRead]);
    expect(await isRead(atEdge)).toBe(true);
    expect(await pairedAt(second)).toBe(endedAt + REMINDER_MATCH_WINDOW_S);
  });

  it("is twelve hours wide", () => {
    expect(REMINDER_MATCH_WINDOW_S).toBe(12 * HOUR);
  });
});

describe("a reminder for a run already uploaded is not written", () => {
  it("claims the event, writes no row, and pairs the upload", async () => {
    const userId = newUlid();
    const athleteId = await connect(userId);
    const landedAt = 1_800_200_000;
    const runId = await seedFileRun(userId, landedAt - HOUR, 3000);
    const objectId = newUlid();

    await deliver({
      type: "strava_reminder",
      athleteId,
      objectId,
      aspectType: "create",
      eventTime: landedAt,
    });

    expect(await reminders(userId)).toStrictEqual([]);
    expect(await pairedAt(runId)).toBe(landedAt);
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

    await landReminder(athleteId, landedAt);

    expect(await reminders(userId)).toHaveLength(1);
  });

  it("does not let the morning's upload swallow the evening's reminder", async () => {
    // The owner's case (2026-09-26): the AM run ends at 09:00 and its
    // reminder lands at 09:30; the file is uploaded at 10:00 and clears it.
    // The PM run ends at 17:30 and its reminder lands at 18:00 — inside the
    // AM run's twelve hours, but the AM run is already paired.
    const userId = newUlid();
    const athleteId = await connect(userId);
    const day = 1_800_400_000;
    // The morning reminder as the consumer wrote it when it landed.
    await seedReminder(userId, day + 9.5 * HOUR);
    const morning = await seedFileRun(userId, day + 9 * HOUR, 3000);
    const pairing = pairWithReminder(coreDb(), userId, morning, day + 9 * HOUR);
    await coreDb().batch([pairing.pairRun, pairing.markRead]);

    await landReminder(athleteId, day + 18 * HOUR);

    const rows = await reminders(userId);
    expect(rows).toHaveLength(2);
    expect(rows.filter((row) => !row.read)).toHaveLength(1);
    expect(await pairedAt(morning)).toBe(day + 9.5 * HOUR);
  });
});

describe("unpairedUploadFor and pairRunWith", () => {
  it("finds a long run that ended at the window's early edge", async () => {
    // Started well before the window opened; what matters is its end.
    const userId = newUlid();
    const landedAt = 1_800_500_000;
    const runId = await seedFileRun(
      userId,
      landedAt - REMINDER_MATCH_WINDOW_S,
      5 * HOUR,
    );

    expect(await unpairedUploadFor(coreDb(), userId, landedAt)).toBe(runId);
  });

  it("finds a run that ended as the reminder landed, and none that ended after", async () => {
    const userId = newUlid();
    const landedAt = 1_800_600_000;
    await seedFileRun(userId, landedAt + 60, 1800);
    expect(await unpairedUploadFor(coreDb(), userId, landedAt)).toBeUndefined();

    const runId = await seedFileRun(userId, landedAt, 1800);
    expect(await unpairedUploadFor(coreDb(), userId, landedAt)).toBe(runId);
  });

  it("offers the oldest unpaired run, and none already paired", async () => {
    const userId = newUlid();
    const landedAt = 1_800_700_000;
    const later = await seedFileRun(userId, landedAt - HOUR, 1800);
    const earlier = await seedFileRun(userId, landedAt - 3 * HOUR, 1800);

    expect(await unpairedUploadFor(coreDb(), userId, landedAt)).toBe(earlier);
    await pairRunWith(coreDb(), earlier, landedAt);
    expect(await unpairedUploadFor(coreDb(), userId, landedAt)).toBe(later);
  });

  it("pairs a run once: a second reminder does not re-pair it", async () => {
    const userId = newUlid();
    const runId = await seedFileRun(userId, 1_800_800_000, 1800);

    await pairRunWith(coreDb(), runId, 1_800_801_000);
    await pairRunWith(coreDb(), runId, 1_800_802_000);

    expect(await pairedAt(runId)).toBe(1_800_801_000);
  });

  it("finds nothing for another runner's upload", async () => {
    const landedAt = 1_800_900_000;
    await seedFileRun(newUlid(), landedAt - HOUR, 1800);

    expect(
      await unpairedUploadFor(coreDb(), newUlid(), landedAt),
    ).toBeUndefined();
  });
});
