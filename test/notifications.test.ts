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
} from "../src/modules/notifications";
import { runsAwaitingVerdict } from "../src/modules/runs";
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

    await markAllNotificationsRead(db, userId);
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

const DAY = 24 * 3600;

/**
The production wiring (`bellStateFn`): runs' own awaiting set, bound.
*/
function awaitingFor(userId: string) {
  return async (limit: number) =>
    runsAwaitingVerdict(notificationsDb(), userId, limit);
}

describe("the bell (round 22, item 13)", () => {
  it("counts runs without a verdict at any age, with a kit or not", async () => {
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
    // Thirty days old and never judged: the fourteen-day window is gone,
    // so it is still a thing to do (FEED-3).
    await makeRun({ userId, startedAt: NOW - 30 * DAY });
    // Someone else's run is never this runner's to-do.
    await makeRun({ userId: newUlid(), startedAt: NOW - 60 });

    expect(await bellState(db, userId, awaitingFor(userId))).toStrictEqual({
      unreadCount: 0,
      verdictsWaiting: 3,
    });
  });

  it("reads the waiting set one past the bell's cap, and no further", async () => {
    const db = notificationsDb();
    const userId = newUlid();
    for (let index = 0; index < 12; index += 1) {
      await makeRun({ userId, startedAt: NOW - index * DAY });
    }
    const asked: number[] = [];
    const awaiting = awaitingFor(userId);

    const state = await bellState(db, userId, async (limit) => {
      asked.push(limit);
      return awaiting(limit);
    });

    // Ten is enough to say "9+", and D1 bills every row read.
    expect(asked).toStrictEqual([10]);
    expect(state.verdictsWaiting).toBe(10);
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

    expect(await bellState(db, userId, awaitingFor(userId))).toStrictEqual({
      unreadCount: 1,
      verdictsWaiting: 0,
    });
  });
});

describe("which rows Mark all read can clear", () => {
  it("says an owed reminder is not markable, and any other unread row is", async () => {
    const db = notificationsDb();
    const userId = newUlid();
    const waiting = await makeRun({ userId, startedAt: NOW - 3600 });
    const judged = await makeRun({ userId, startedAt: NOW - 3600 });
    await makeEntry({ userId, runId: judged, verdict: 0 });
    await createNotification(db, {
      userId,
      kind: "kit_reminder",
      subjectId: waiting,
      body: "owed",
    });
    await createNotification(db, {
      userId,
      kind: "kit_reminder",
      subjectId: judged,
      body: "judged",
    });
    await createNotification(db, {
      userId,
      kind: "import_failed",
      subjectId: waiting,
      body: "other kind",
    });

    const rows = await listNotifications(db, userId);
    const markable = Object.fromEntries(
      rows.map((row) => [row.body, row.markable]),
    );
    expect(markable).toStrictEqual({
      owed: false,
      judged: true,
      "other kind": true,
    });
  });

  it("says a read row is not markable, owed or not", async () => {
    const db = notificationsDb();
    const userId = newUlid();
    await createNotification(db, {
      userId,
      kind: "import_failed",
      subjectId: newUlid(),
      body: "read",
    });
    await markAllNotificationsRead(db, userId);

    const [row] = await listNotifications(db, userId);
    expect(row?.markable).toBe(false);
  });

  it("agrees with what Mark all read then clears", async () => {
    const db = notificationsDb();
    const userId = newUlid();
    const waiting = await makeRun({ userId, startedAt: NOW - 3600 });
    await createNotification(db, {
      userId,
      kind: "kit_reminder",
      subjectId: waiting,
      body: "owed",
    });
    await createNotification(db, {
      userId,
      kind: "import_failed",
      subjectId: newUlid(),
      body: "other",
    });
    const before = await listNotifications(db, userId);
    const offered = before.filter((row) => row.markable).map((row) => row.body);

    await markAllNotificationsRead(db, userId);

    const after = await listNotifications(db, userId);
    const cleared = after
      .filter(
        (row) => row.read && before.some((b) => b.id === row.id && !b.read),
      )
      .map((row) => row.body);
    expect(cleared).toStrictEqual(offered);
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

    await markAllNotificationsRead(db, userId);

    const rows = await listNotifications(db, userId);
    const unread = rows.filter((row) => !row.read).map((row) => row.body);
    expect(unread).toStrictEqual([
      "Add your kit for the run you just imported.",
    ]);
  });

  it("keeps a month-old reminder unread while its run still waits", async () => {
    const db = notificationsDb();
    const userId = newUlid();
    const old = await makeRun({ userId, startedAt: NOW - 30 * DAY });
    await createNotification(db, {
      userId,
      kind: "kit_reminder",
      subjectId: old,
      body: "Add your kit.",
    });

    await markAllNotificationsRead(db, userId);

    expect(await unreadNotificationCount(db, userId)).toBe(1);
  });

  it("leaves unread exactly the reminders runs' awaiting set names", async () => {
    // Mark all read holds the awaiting set as SQL it can put in a
    // subquery; runs owns the definition. This pins the two together.
    const db = notificationsDb();
    const userId = newUlid();
    const bare = await makeRun({ userId, startedAt: NOW - 40 * DAY });
    const dressed = await makeRun({ userId, startedAt: NOW - 2 * DAY });
    await makeEntry({ userId, runId: dressed, createdAt: NOW });
    const judged = await makeRun({ userId, startedAt: NOW - DAY });
    await makeEntry({ userId, runId: judged, verdict: 2 });
    for (const runId of [bare, dressed, judged]) {
      await createNotification(db, {
        userId,
        kind: "kit_reminder",
        subjectId: runId,
        body: runId,
      });
    }

    await markAllNotificationsRead(db, userId);

    // Each reminder's body is its run's id, so the two sets compare as
    // plain strings.
    const notificationRows = await listNotifications(db, userId);
    const unread = new Set(
      notificationRows.filter((row) => !row.read).map((row) => row.body),
    );
    const awaitingRuns = await runsAwaitingVerdict(db, userId, 100);
    expect(unread).toStrictEqual(new Set(awaitingRuns.map((run) => run.id)));
    expect(unread).toStrictEqual(new Set([bare, dressed]));
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

    await markAllNotificationsRead(db, userId);

    expect(await unreadNotificationCount(db, otherUserId)).toBe(1);
  });
});
