import { describe, expect, it } from "vitest";

import { newUlid } from "../src/lib/ids";
import { coreDb } from "../src/modules/runs/core-db";
import { notificationsDb } from "../src/modules/notifications/db";
import {
  bellState,
  createNotification,
  listNotifications,
  markAllNotificationsRead,
  unreadNotificationCount,
  VERDICT_WAIT_WINDOW_S,
} from "../src/modules/notifications";
import { makeEntry, makeRun, NOW } from "./feed/helpers";
import type { NotificationKind } from "../src/modules/notifications";
import { nowSeconds } from "../src/lib/now";

const KIT_REMINDER: NotificationKind = "kit_reminder";

describe("notifications (102 §7, resilience law 1)", () => {
  it("dedupes on (user, kind, subject) — a duplicate create is a silent no-op", async () => {
    const db = coreDb();
    const userId = newUlid();
    const subjectId = newUlid();

    await createNotification(db, {
      userId,
      kind: KIT_REMINDER,
      subjectId,
      body: "Add your kit.",
    });
    await createNotification(db, {
      userId,
      kind: KIT_REMINDER,
      subjectId,
      body: "Add your kit.",
    });

    const rows = await listNotifications(db, userId);
    expect(rows).toHaveLength(1);
  });

  it("counts only unread notifications, and mark-all-read clears them", async () => {
    const db = coreDb();
    const userId = newUlid();

    await createNotification(db, {
      userId,
      kind: "strava_reminder",
      subjectId: newUlid(),
      body: "New run on Strava — log your kit?",
    });
    await createNotification(db, {
      userId,
      kind: "import_failed",
      subjectId: newUlid(),
      body: "Your run import didn't work.",
    });

    expect(await unreadNotificationCount(db, userId)).toBe(2);

    await markAllNotificationsRead(db, userId, NOW);
    expect(await unreadNotificationCount(db, userId)).toBe(0);

    const rows = await listNotifications(db, userId);
    expect(rows.every((row) => row.read)).toBe(true);
  });

  it("lists only the requesting user's notifications", async () => {
    const db = coreDb();
    const userId = newUlid();
    const otherUserId = newUlid();

    await createNotification(db, {
      userId: otherUserId,
      kind: KIT_REMINDER,
      subjectId: newUlid(),
      body: "Not yours.",
    });
    await createNotification(db, {
      userId,
      kind: KIT_REMINDER,
      subjectId: newUlid(),
      body: "Yours.",
    });

    const rows = await listNotifications(db, userId);
    expect(rows.map((row) => row.body)).toEqual(["Yours."]);
  });
});

describe("what a notification row records", () => {
  it("stamps created_at in epoch seconds, not milliseconds", async () => {
    // The list is ordered by this column. A millisecond value sorts above
    // every real row for the next thousand years, so one bad insert pins
    // itself to the top of the bell forever.
    const db = notificationsDb();
    const userId = newUlid();
    const before = nowSeconds();

    await createNotification(db, {
      userId,
      kind: "import_failed",
      subjectId: newUlid(),
      body: "Your import failed.",
    });

    const [row] = await listNotifications(db, userId);
    expect(row?.createdAt).toBeGreaterThanOrEqual(before - 5);
    expect(row?.createdAt).toBeLessThanOrEqual(before + 5);
    // Unread is the state the bell counts; a row that arrives read is a
    // notification nobody is told about.
    expect(row?.read).toBe(false);
  });

  it("hands out a working core-database handle", async () => {
    // `notificationsDb()` is the module's only binding touch, and nothing
    // imported it in a test — so the whole function body could be deleted
    // without a failure.
    const count = await unreadNotificationCount(notificationsDb(), newUlid());
    expect(count).toBe(0);
  });
});

describe("the bell (round 22, item 13)", () => {
  it("counts runs from the last 14 days without a verdict, with a kit or not", async () => {
    const db = notificationsDb();
    const userId = newUlid();
    // No entry at all: a run nobody has dressed yet is still waiting.
    await makeRun({ userId, startedAt: NOW - 3600 });
    // An entry with no verdict: dressed, not judged, still waiting.
    const dressed = await makeRun({ userId, startedAt: NOW - 7200 });
    await makeEntry({ userId, runId: dressed, createdAt: NOW });
    // Judged — dialed is 0, which is a verdict, not an absence of one.
    const judged = await makeRun({ userId, startedAt: NOW - 3600 });
    await makeEntry({ userId, runId: judged, verdict: 0 });
    // Exactly on the window's edge counts; a second older does not.
    await makeRun({ userId, startedAt: NOW - VERDICT_WAIT_WINDOW_S });
    await makeRun({ userId, startedAt: NOW - VERDICT_WAIT_WINDOW_S - 1 });
    // Someone else's run is never this runner's to-do.
    await makeRun({ userId: newUlid(), startedAt: NOW - 60 });

    expect(await bellState(db, userId, NOW)).toStrictEqual({
      unreadCount: 0,
      verdictsWaiting: 3,
    });
  });

  it("is fourteen days, not a round number near it", () => {
    expect(VERDICT_WAIT_WINDOW_S).toBe(1_209_600);
  });

  it("counts unread notifications for the dot, and only this runner's", async () => {
    const db = notificationsDb();
    const userId = newUlid();
    await createNotification(db, {
      userId,
      kind: "import_failed",
      subjectId: newUlid(),
      body: "Your run import didn't work.",
    });
    await createNotification(db, {
      userId: newUlid(),
      kind: "import_failed",
      subjectId: newUlid(),
      body: "Not yours.",
    });

    expect(await bellState(db, userId, NOW)).toStrictEqual({
      unreadCount: 1,
      verdictsWaiting: 0,
    });
  });
});

describe("mark all read never clears a verdict still owed", () => {
  it("leaves a kit reminder unread while its run waits, and takes the rest", async () => {
    const db = notificationsDb();
    const userId = newUlid();
    const waiting = await makeRun({ userId, startedAt: NOW - 3600 });
    const judged = await makeRun({ userId, startedAt: NOW - 3600 });
    await makeEntry({ userId, runId: judged, verdict: -1 });
    await createNotification(db, {
      userId,
      kind: "kit_reminder",
      subjectId: waiting,
      body: "Add your kit for the run you just imported.",
    });
    await createNotification(db, {
      userId,
      kind: "kit_reminder",
      subjectId: judged,
      body: "Add your kit for the other run.",
    });
    // A different kind whose subject happens to be the waiting run: only
    // the verdict reminder is a to-do.
    await createNotification(db, {
      userId,
      kind: "strava_reminder",
      subjectId: waiting,
      body: "New run on Strava — log your kit?",
    });

    await markAllNotificationsRead(db, userId, NOW);

    const rows = await listNotifications(db, userId);
    const unread = rows.filter((row) => !row.read).map((row) => row.body);
    expect(unread).toStrictEqual([
      "Add your kit for the run you just imported.",
    ]);
  });

  it("takes a reminder whose run has left the window", async () => {
    const db = notificationsDb();
    const userId = newUlid();
    const old = await makeRun({
      userId,
      startedAt: NOW - VERDICT_WAIT_WINDOW_S - 1,
    });
    await createNotification(db, {
      userId,
      kind: "kit_reminder",
      subjectId: old,
      body: "Add your kit.",
    });

    await markAllNotificationsRead(db, userId, NOW);

    expect(await unreadNotificationCount(db, userId)).toBe(0);
  });

  it("marks only this runner's rows", async () => {
    const db = notificationsDb();
    const userId = newUlid();
    const otherUserId = newUlid();
    await createNotification(db, {
      userId: otherUserId,
      kind: "import_failed",
      subjectId: newUlid(),
      body: "Not yours.",
    });

    await markAllNotificationsRead(db, userId, NOW);

    expect(await unreadNotificationCount(db, otherUserId)).toBe(1);
  });
});
