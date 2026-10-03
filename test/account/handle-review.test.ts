import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/d1";
import { beforeEach, describe, expect, it } from "vitest";

import {
  moderationActions,
  reviewQueue,
  userProfiles,
  usernameHistory,
} from "../../src/db/schema-core";
import { env } from "../../src/env";
import { newUlid, ulidSchema } from "../../src/lib/ids";
import { rescreenHandles } from "../../src/modules/account/handle-rescreen";
import { reviewFlaggedHandle } from "../../src/modules/account/handle-review";
import type { ScreenHandle } from "../../src/modules/account/handle-screen";
import {
  claimUsername,
  renameNoticeOf,
} from "../../src/modules/account/username";
import { enqueueForReview, pendingReviewQueue } from "../../src/modules/safety";

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

const UNKNOWN: ScreenHandle = () => Promise.resolve("unknown");

/**
 * A runner whose handle was claimed during an outage and flagged by the
 * re-ask: the state the Desk's review row is about.
 */
async function flaggedRunner(handle = "quadzilla_69") {
  const userId = newUlid();
  await claimUsername(db, userId, handle, UNKNOWN);
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
      await reviewFlaggedHandle(db, REVIEWER, { queueId, action: "keep" }),
    ).toBe("resolved");

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

    await reviewFlaggedHandle(db, REVIEWER, { queueId, action: "keep" });

    expect(await profileOf(userId)).toMatchObject({
      username: "second_pick",
      screen: "unknown",
    });
  });
});

describe("Rename", () => {
  it("is the moderator's force-rename: a placeholder, the reason O0 quotes, the audit row and the row settled", async () => {
    const { userId, queueId } = await flaggedRunner();

    expect(
      await reviewFlaggedHandle(db, REVIEWER, {
        queueId,
        action: "rename",
        nameReason: "Offensive or sexual",
      }),
    ).toBe("resolved");

    const profile = await profileOf(userId);
    expect(profile?.username).toMatch(/^runner_\d{4}$/u);
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
    // Every placeholder is somebody's old handle: the rename cannot land.
    await env.DIALED_CORE.prepare(
      `WITH RECURSIVE n(i) AS (SELECT 0 UNION ALL SELECT i + 1 FROM n WHERE i < 9999)
       INSERT INTO username_history (username, user_id, retired_at)
       SELECT printf('runner_%04d', i), 'someone-else', 1 FROM n`,
    ).run();

    expect(
      await reviewFlaggedHandle(db, REVIEWER, {
        queueId,
        action: "rename",
        nameReason: "Advertising",
      }),
    ).toBe("taken");

    expect(await profileOf(userId)).toMatchObject({
      username: "quadzilla_69",
      screen: "flagged",
    });
    expect(await queueRow(queueId)).toMatchObject({ status: "pending" });
  });
});

describe("a row there is nothing to decide on", () => {
  it("answers a settled row as settled, and writes nothing", async () => {
    const { userId, queueId } = await flaggedRunner();
    await reviewFlaggedHandle(db, REVIEWER, { queueId, action: "keep" });

    expect(
      await reviewFlaggedHandle(db, "someone-else", {
        queueId,
        action: "rename",
        nameReason: "Advertising",
      }),
    ).toBe("already_resolved");
    expect(await profileOf(userId)).toMatchObject({ username: "quadzilla_69" });
    expect(await queueRow(queueId)).toMatchObject({ resolvedBy: REVIEWER });
  });

  it("answers a row that never existed as not found", async () => {
    expect(
      await reviewFlaggedHandle(db, REVIEWER, {
        queueId: newUlid(),
        action: "keep",
      }),
    ).toBe("not_found");
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
        action: "rename",
        nameReason: "Advertising",
      }),
    ).toBe("not_found");
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
      await reviewFlaggedHandle(db, REVIEWER, { queueId, action: "keep" }),
    ).toBe("not_found");
    expect(await queueRow(queueId)).toMatchObject({ status: "pending" });
  });
});
