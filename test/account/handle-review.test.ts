import { and, eq, inArray } from "drizzle-orm";
import { anyShownRow, shownRowOf } from "../safety/helpers";
import { drizzle } from "drizzle-orm/d1";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  moderationActions,
  notifications,
  reports,
  reviewQueue,
  userProfiles,
  usernameHistory,
} from "../../src/db/schema-core";
import { env } from "../../src/env";
import { newUlid, ulidSchema } from "../../src/lib/ids";
import { nowSeconds } from "../../src/lib/now";
import { rescreenHandles } from "../../src/modules/account/handles/handle-rescreen";
import { reviewFlaggedHandle } from "../../src/modules/account/handles/handle-review";
import type { ScreenHandle } from "../../src/modules/account/handles/handle-screen";
import {
  claimUsername,
  renameNoticeOf,
} from "../../src/modules/account/handles/username";
import { enqueueForReview } from "../../src/modules/safety";
import { pendingReviewQueue } from "../../src/modules/safety/review/review";

/**
 * D-97: a handle the re-ask flagged gets Keep or Rename on its Desk
 * review row — never Remove.
 */
const db = drizzle(env.DIALED_CORE);
const REVIEWER = "desk-operator";

beforeEach(async () => {
  await db.batch([
    db.delete(userProfiles),
    db.delete(usernameHistory),
    db.delete(reviewQueue),
    db.delete(moderationActions),
  ]);
});

afterEach(() => {
  vi.restoreAllMocks();
});

const UNKNOWN: ScreenHandle = () => Promise.resolve("unknown");

/**
 * A runner whose handle was claimed during an outage and flagged by the
 * re-ask: the state the Desk's review row is about.
 */
async function flaggedRunner() {
  const userId = newUlid();
  await claimUsername(db, userId, "quadzilla_69", UNKNOWN);
  await rescreenHandles(db, () => Promise.resolve("flagged"), [], 5000);
  const [row] = await pendingReviewQueue();
  if (row === undefined) throw new Error("nothing queued");
  return { userId, queueId: ulidSchema.parse(row.id), row };
}

async function profileOf(userId: string) {
  const [row] = await db
    .select({
      username: userProfiles.username,
      screen: userProfiles.usernameScreen,
      reason: userProfiles.usernameResetReason,
    })
    .from(userProfiles)
    .where(eq(userProfiles.userId, userId));
  return row;
}

async function queueRow(queueId: string) {
  const [row] = await db
    .select({ status: reviewQueue.status, resolvedBy: reviewQueue.resolvedBy })
    .from(reviewQueue)
    .where(eq(reviewQueue.id, queueId));
  return row;
}

describe("the review row", () => {
  it("shows the flagged handle, marked as one", async () => {
    const { userId, row } = await flaggedRunner();
    expect(row).toMatchObject({
      subjectType: "profile",
      subjectId: userId,
      source: "classifier",
      subject: { label: "quadzilla_69", photoKeys: [], handleFlagged: true },
    });
  });

  it("does not mark a reported profile whose handle nobody flagged", async () => {
    const userId = newUlid();
    await claimUsername(db, userId, "dee_runs", () => Promise.resolve("clear"));
    await db.batch([
      enqueueForReview(db, {
        subjectType: "profile",
        subjectId: userId,
        source: "reports",
      }),
    ]);
    const [row] = await pendingReviewQueue();
    expect(row?.subject.handleFlagged).toBe(false);
  });
});

describe("Keep", () => {
  it("clears the flag and approves the row, renaming nothing", async () => {
    const { userId, queueId } = await flaggedRunner();

    expect(
      await reviewFlaggedHandle(db, REVIEWER, {
        queueId,
        shown: await shownRowOf(queueId),
        action: "keep",
      }),
    ).toStrictEqual({ outcome: "resolved" });

    expect(await profileOf(userId)).toMatchObject({
      username: "quadzilla_69",
      screen: "clear",
    });
    expect(await renameNoticeOf(db, userId)).toBeUndefined();
    expect(await queueRow(queueId)).toStrictEqual({
      status: "approved",
      resolvedBy: REVIEWER,
    });
  });

  it("leaves a newer verdict alone when the runner renamed since", async () => {
    const { userId, queueId } = await flaggedRunner();
    await claimUsername(db, userId, "second_pick", UNKNOWN);

    await reviewFlaggedHandle(db, REVIEWER, {
      queueId,
      shown: await shownRowOf(queueId),
      action: "keep",
    });

    expect(await profileOf(userId)).toMatchObject({
      username: "second_pick",
      screen: "unknown",
    });
  });
});

describe("Keep racing another decision on the row (SA-L11)", () => {
  it("clears nothing once the row was settled between its read and its batch", async () => {
    const { userId, queueId } = await flaggedRunner();

    const shown = await shownRowOf(queueId);
    const [kept] = await Promise.all([
      reviewFlaggedHandle(db, REVIEWER, { queueId, shown, action: "keep" }),
      db
        .update(reviewQueue)
        .set({ status: "removed", resolvedBy: "another-operator" })
        .where(eq(reviewQueue.id, queueId)),
    ]);

    expect(kept).toStrictEqual({ outcome: "already_resolved" });
    expect(await profileOf(userId)).toMatchObject({ screen: "flagged" });
    expect(await queueRow(queueId)).toStrictEqual({
      status: "removed",
      resolvedBy: "another-operator",
    });
  });
});

describe("Rename", () => {
  it("is the moderator's force-rename: a placeholder, the reason O0 quotes, the audit row and the row settled", async () => {
    const { userId, queueId } = await flaggedRunner();

    expect(
      await reviewFlaggedHandle(db, REVIEWER, {
        queueId,
        shown: await shownRowOf(queueId),
        handle: "quadzilla_69",
        action: "rename",
        nameReason: "Offensive or sexual",
      }),
    ).toStrictEqual({ outcome: "resolved" });

    const profile = await profileOf(userId);
    expect(profile?.username).toMatch(/^runner_\d{6}$/u);
    expect(profile?.screen).toBeNull();
    expect(await renameNoticeOf(db, userId)).toStrictEqual({
      previous: "quadzilla_69",
      current: profile?.username,
      reason: "Offensive or sexual",
    });
    expect(await queueRow(queueId)).toStrictEqual({
      status: "removed",
      resolvedBy: REVIEWER,
    });
    const audit = await db
      .select({
        actorId: moderationActions.actorId,
        action: moderationActions.action,
        subjectId: moderationActions.subjectId,
        reason: moderationActions.reason,
      })
      .from(moderationActions);
    expect(audit).toStrictEqual([
      {
        actorId: REVIEWER,
        action: "rename",
        subjectId: userId,
        reason: "Offensive or sexual (was @quadzilla_69)",
      },
    ]);
  });

  it("says taken, and leaves the row open, when the drawn placeholder is held", async () => {
    const { userId, queueId } = await flaggedRunner();
    // The placeholder drawn is somebody's old handle: the rename cannot land.
    await db.insert(usernameHistory).values({
      username: "runner_000042",
      userId: "someone-else",
      retiredAt: 1,
    });
    vi.spyOn(globalThis.crypto, "getRandomValues").mockImplementation(
      (array) => {
        if (array instanceof Uint32Array) array.fill(42);
        return array;
      },
    );

    expect(
      await reviewFlaggedHandle(db, REVIEWER, {
        queueId,
        shown: await shownRowOf(queueId),
        handle: "quadzilla_69",
        action: "rename",
        nameReason: "Advertising",
      }),
    ).toStrictEqual({ outcome: "taken" });

    expect(await profileOf(userId)).toMatchObject({
      username: "quadzilla_69",
      screen: "flagged",
    });
    expect(await queueRow(queueId)).toMatchObject({ status: "pending" });
  });
});

describe("Rename racing the runner's own pick (R-121)", () => {
  it("says moved, renames nothing, records nothing and leaves the row open", async () => {
    const { userId, queueId } = await flaggedRunner();
    // The runner picks a new handle between the rename's read and its
    // write: the first batch is the read that decides, the second writes.
    const counter = { batches: 0 };
    const batch: typeof db.batch = async (items) => {
      counter.batches += 1;
      if (counter.batches === 2) {
        await claimUsername(db, userId, "fresh_pick", () =>
          Promise.resolve("clear"),
        );
      }
      return db.batch(items);
    };
    const raced = new Proxy(db, {
      get(target, property, receiver): unknown {
        return property === "batch"
          ? batch
          : Reflect.get(target, property, receiver);
      },
    });

    expect(
      await reviewFlaggedHandle(raced, REVIEWER, {
        queueId,
        shown: await shownRowOf(queueId),
        handle: "quadzilla_69",
        action: "rename",
        nameReason: "Advertising",
      }),
    ).toStrictEqual({ outcome: "moved", username: "fresh_pick" });

    const profile = await profileOf(userId);
    expect(profile?.username).toBe("fresh_pick");
    expect(profile?.reason).toBeNull();
    expect(await queueRow(queueId)).toMatchObject({ status: "pending" });
    expect(await db.select().from(moderationActions)).toStrictEqual([]);
    const [locked] = await db
      .select()
      .from(usernameHistory)
      .where(eq(usernameHistory.username, "quadzilla_69"));
    expect(locked?.lockedAt).toBeNull();
  });
});

describe("a row there is nothing to decide on", () => {
  it("answers a settled row as settled, and writes nothing", async () => {
    const { userId, queueId } = await flaggedRunner();
    await reviewFlaggedHandle(db, REVIEWER, {
      queueId,
      shown: await shownRowOf(queueId),
      action: "keep",
    });

    expect(
      await reviewFlaggedHandle(db, "someone-else", {
        queueId,
        shown: await shownRowOf(queueId),
        handle: "quadzilla_69",
        action: "rename",
        nameReason: "Advertising",
      }),
    ).toStrictEqual({ outcome: "already_resolved" });
    expect(await profileOf(userId)).toMatchObject({ username: "quadzilla_69" });
    expect(await queueRow(queueId)).toMatchObject({ resolvedBy: REVIEWER });
  });

  it("answers a row that never existed as not found", async () => {
    expect(
      await reviewFlaggedHandle(db, REVIEWER, {
        queueId: newUlid(),
        shown: anyShownRow,
        action: "keep",
      }),
    ).toStrictEqual({ outcome: "not_found" });
  });

  it("answers not found for a runner with no handle to rename", async () => {
    const userId = newUlid();
    await db.insert(userProfiles).values({ userId });
    const queueId = newUlid();
    await db.insert(reviewQueue).values({
      id: queueId,
      subjectType: "profile",
      subjectId: userId,
      source: "classifier",
      status: "pending",
      createdAt: 1,
    });

    expect(
      await reviewFlaggedHandle(db, REVIEWER, {
        queueId,
        shown: await shownRowOf(queueId),
        handle: "quadzilla_69",
        action: "rename",
        nameReason: "Advertising",
      }),
    ).toStrictEqual({ outcome: "not_found" });
    expect(await queueRow(queueId)).toMatchObject({ status: "pending" });
  });

  it("touches nothing for a row about anything but a runner", async () => {
    const queueId = newUlid();
    await db.insert(reviewQueue).values({
      id: queueId,
      subjectType: "entry",
      subjectId: "e-1",
      source: "reports",
      status: "pending",
      createdAt: 1,
    });

    expect(
      await reviewFlaggedHandle(db, REVIEWER, {
        queueId,
        shown: await shownRowOf(queueId),
        action: "keep",
      }),
    ).toStrictEqual({ outcome: "not_found" });
    expect(await queueRow(queueId)).toMatchObject({ status: "pending" });
  });
});

describe("a decision on the row as the page showed it", () => {
  it("tells whoever reported the runner that Keep left it up", async () => {
    const { userId, queueId } = await flaggedRunner();
    const reporter = newUlid();
    await db.insert(reports).values({
      id: newUlid(),
      reporterId: reporter,
      subjectType: "profile",
      subjectId: userId,
      reason: "impersonation",
      createdAt: 1,
    });

    await reviewFlaggedHandle(db, REVIEWER, {
      queueId,
      shown: await shownRowOf(queueId),
      action: "keep",
    });

    const told = await db
      .select({ kind: notifications.kind })
      .from(notifications)
      .where(eq(notifications.userId, reporter));
    expect(told).toStrictEqual([{ kind: "report_kept" }]);
  });

  it("restarts the report count from when the page was read, and tells only those who reported by then", async () => {
    const { userId, queueId } = await flaggedRunner();
    await db
      .update(reviewQueue)
      .set({ openedAt: nowSeconds() - 100 })
      .where(eq(reviewQueue.id, queueId));
    const shown = await shownRowOf(queueId);
    const before = newUlid();
    const after = newUlid();
    for (const [reporterId, createdAt] of [
      [before, shown.readAt - 5],
      [after, shown.readAt + 5],
    ] as const) {
      await db.insert(reports).values({
        id: newUlid(),
        reporterId,
        subjectType: "profile",
        subjectId: userId,
        reason: "impersonation",
        createdAt,
      });
    }

    await reviewFlaggedHandle(db, REVIEWER, {
      queueId,
      shown: { ...shown, readAt: shown.readAt - 1 },
      action: "keep",
    });

    const [row] = await db
      .select({ approvedAt: reviewQueue.approvedAt })
      .from(reviewQueue)
      .where(eq(reviewQueue.id, queueId));
    expect(row?.approvedAt).toBe(shown.readAt - 1);
    const told = await db
      .select({ userId: notifications.userId })
      .from(notifications)
      .where(
        and(
          eq(notifications.kind, "report_kept"),
          inArray(notifications.userId, [before, after]),
        ),
      );
    expect(told).toStrictEqual([{ userId: before }]);
  });

  it("keeps nothing on a row re-opened since the page showed it", async () => {
    const { userId, queueId } = await flaggedRunner();
    const shown = await shownRowOf(queueId);

    expect(
      await reviewFlaggedHandle(db, REVIEWER, {
        queueId,
        shown: { ...shown, source: "reports" },
        action: "keep",
      }),
    ).toStrictEqual({ outcome: "already_resolved" });

    expect(await profileOf(userId)).toMatchObject({ screen: "flagged" });
    const row = await queueRow(queueId);
    expect(row?.status).toBe("pending");
  });

  it("keeps nothing when the row's source changes between its read and its batch", async () => {
    const { userId, queueId } = await flaggedRunner();
    const shown = await shownRowOf(queueId);

    const [kept] = await Promise.all([
      reviewFlaggedHandle(db, REVIEWER, { queueId, shown, action: "keep" }),
      db
        .update(reviewQueue)
        .set({ source: "reports" })
        .where(eq(reviewQueue.id, queueId)),
    ]);

    expect(kept).toStrictEqual({ outcome: "already_resolved" });
    expect(await profileOf(userId)).toMatchObject({ screen: "flagged" });
  });

  it("renames nothing on a row re-opened since the page showed it", async () => {
    const { userId, queueId } = await flaggedRunner();
    const shown = await shownRowOf(queueId);

    expect(
      await reviewFlaggedHandle(db, REVIEWER, {
        queueId,
        shown: { ...shown, openedAt: 1 },
        handle: "quadzilla_69",
        action: "rename",
        nameReason: "Advertising",
      }),
    ).toStrictEqual({ outcome: "already_resolved" });

    expect(await profileOf(userId)).toMatchObject({
      username: "quadzilla_69",
    });
  });

  it("settles no row when its source changes between the rename's read and its batch", async () => {
    const { queueId } = await flaggedRunner();
    const shown = await shownRowOf(queueId);

    await Promise.all([
      reviewFlaggedHandle(db, REVIEWER, {
        queueId,
        shown,
        handle: "quadzilla_69",
        action: "rename",
        nameReason: "Advertising",
      }),
      db
        .update(reviewQueue)
        .set({ source: "reports" })
        .where(eq(reviewQueue.id, queueId)),
    ]);

    const row = await queueRow(queueId);
    expect(row?.status).toBe("pending");
  });

  it("takes away only the handle shown: one the runner left since is locked, and nothing is renamed", async () => {
    const { userId, queueId } = await flaggedRunner();
    await claimUsername(db, userId, "fine_one", UNKNOWN);

    expect(
      await reviewFlaggedHandle(db, REVIEWER, {
        queueId,
        shown: await shownRowOf(queueId),
        handle: "quadzilla_69",
        action: "rename",
        nameReason: "Advertising",
      }),
    ).toStrictEqual({ outcome: "moved", username: "fine_one" });

    expect(await profileOf(userId)).toMatchObject({ username: "fine_one" });
    const own = and(
      eq(usernameHistory.username, "quadzilla_69"),
      eq(usernameHistory.userId, userId),
    );
    const [locked] = await db
      .select({ lockedAt: usernameHistory.lockedAt })
      .from(usernameHistory)
      .where(own);
    expect(locked?.lockedAt).toEqual(expect.any(Number));
    const audit = await db
      .select({
        actorId: moderationActions.actorId,
        action: moderationActions.action,
        subjectId: moderationActions.subjectId,
        reason: moderationActions.reason,
      })
      .from(moderationActions);
    expect(audit).toStrictEqual([
      {
        actorId: REVIEWER,
        action: "rename",
        subjectId: userId,
        reason:
          "Advertising (locked @quadzilla_69; the runner had already changed to @fine_one)",
      },
    ]);
    const back = await claimUsername(db, userId, "quadzilla_69", UNKNOWN);
    expect(back).not.toMatchObject({ kind: "claimed" });
    expect(await profileOf(userId)).toMatchObject({ username: "fine_one" });
  });

  it("locks no handle another runner gave up", async () => {
    const { userId, queueId } = await flaggedRunner();
    const other = newUlid();
    await claimUsername(db, other, "old_name", UNKNOWN);
    await claimUsername(db, other, "new_name", UNKNOWN);

    await reviewFlaggedHandle(db, REVIEWER, {
      queueId,
      shown: await shownRowOf(queueId),
      handle: "old_name",
      action: "rename",
      nameReason: "Advertising",
    });

    const [row] = await db
      .select({ lockedAt: usernameHistory.lockedAt })
      .from(usernameHistory)
      .where(eq(usernameHistory.username, "old_name"));
    expect(row?.lockedAt).toBeNull();
    expect(await db.select().from(moderationActions)).toStrictEqual([]);
    expect(await profileOf(userId)).toMatchObject({
      username: "quadzilla_69",
    });
  });
});
