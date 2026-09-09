import { describe, expect, it } from "vitest";

import { newUlid } from "../src/lib/ids";
import { coreDb } from "../src/modules/runs/core-db";
import { notificationsDb } from "../src/modules/notifications/db";
import {
  createNotification,
  listNotifications,
  markAllNotificationsRead,
  unreadNotificationCount,
} from "../src/modules/notifications";
import type { NotificationKind } from "../src/modules/notifications";

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
    const before = Math.floor(Date.now() / 1000);

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
