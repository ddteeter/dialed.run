import { drizzle } from "drizzle-orm/d1";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { reviewQueue, userProfiles } from "../../src/db/schema-core";
import { env } from "../../src/env";
import { newUlid } from "../../src/lib/ids";
import { nowSeconds } from "../../src/lib/now";
import { handleScheduled } from "../../src/modules/ops";
import { NotFoundError } from "../../src/lib/errors";
import { deskToday, isOperator, todayCounts } from "../../src/modules/ops/desk";
import { operatorOrNotFound } from "../../src/modules/ops/desk-gate";

/**
 * The Desk's Today (Operator Screens D0): three numbers, read by the page
 * and by the digest from the same function, so the two cannot disagree.
 */

const DAY = 24 * 60 * 60;

function coreDb() {
  return drizzle(env.DIALED_CORE);
}

async function queueRow(
  overrides: Partial<typeof reviewQueue.$inferInsert> = {},
): Promise<void> {
  await coreDb()
    .insert(reviewQueue)
    .values({
      id: newUlid(),
      subjectType: "photo",
      subjectId: newUlid(),
      source: "reports",
      status: "pending",
      createdAt: nowSeconds(),
      ...overrides,
    });
}

async function runner(bannedAt?: number): Promise<void> {
  await coreDb().insert(userProfiles).values({ userId: newUlid(), bannedAt });
}

beforeEach(async () => {
  await coreDb().delete(reviewQueue);
  await coreDb().delete(userProfiles);
});

describe("todayCounts", () => {
  it("is all zeros, and no oldest, on an empty desk", async () => {
    expect(await todayCounts()).toStrictEqual({
      waiting: 0,
      oldestWaitingAt: undefined,
      screenerUnfinished: 0,
      bansThisWeek: 0,
      bansAllTime: 0,
    });
  });

  it("counts every undecided row, claimed or not, and dates the oldest", async () => {
    const now = nowSeconds();
    await queueRow({ createdAt: now - 19 * 3600 });
    await queueRow({ status: "reviewing", createdAt: now - 2 * 3600 });
    await queueRow({ source: "classifier", createdAt: now - 5 * 3600 });
    await queueRow({ status: "approved", createdAt: now - 40 * 3600 });
    await queueRow({ status: "removed", createdAt: now - 41 * 3600 });

    const counts = await todayCounts();

    // Decided rows stay in the table for the record, and older than any
    // waiting one here, so counting them would move both numbers.
    expect(counts.waiting).toBe(3);
    expect(counts.oldestWaitingAt).toBe(now - 19 * 3600);
  });

  it("dates the oldest across both sources, whichever holds it", async () => {
    const now = nowSeconds();
    await queueRow({ source: "reports", createdAt: now - 3600 });
    await queueRow({ source: "classifier", createdAt: now - 9 * 3600 });

    const counts = await todayCounts();

    expect(counts.oldestWaitingAt).toBe(now - 9 * 3600);
  });

  it("counts the screener's rows apart from the reporters'", async () => {
    await queueRow({ source: "classifier" });
    await queueRow({ source: "classifier" });
    await queueRow({ source: "classifier", status: "removed" });
    await queueRow({ source: "reports" });

    const counts = await todayCounts();

    expect(counts.screenerUnfinished).toBe(2);
    expect(counts.waiting).toBe(3);
  });

  it("has no screener count when only reporters are waiting", async () => {
    await queueRow({ source: "reports" });

    const counts = await todayCounts();

    expect(counts.screenerUnfinished).toBe(0);
  });

  it("counts bans this week and all time, and nobody who is not banned", async () => {
    const now = nowSeconds();
    await runner(now - DAY);
    await runner(now - 7 * DAY + 60);
    await runner(now - 8 * DAY);
    await runner(now - 90 * DAY);
    await runner();

    const counts = await todayCounts();

    expect(counts.bansThisWeek).toBe(2);
    expect(counts.bansAllTime).toBe(4);
  });

  it("has no bans this week when every ban is older", async () => {
    await runner(nowSeconds() - 30 * DAY);

    const counts = await todayCounts();

    expect(counts.bansThisWeek).toBe(0);
    expect(counts.bansAllTime).toBe(1);
  });
});

describe("the digest reads Today's own number (D5)", () => {
  it("reports the same waiting count the Desk shows", async () => {
    await queueRow();
    await queueRow({ status: "reviewing" });

    const { waiting } = await todayCounts();
    const outcome = await handleScheduled({
      cron: "0 12 * * *",
    } as ScheduledController);

    expect(waiting).toBe(2);
    expect(outcome.anomalies).toContain(
      `${String(waiting)} item(s) awaiting moderation review`,
    );
  });
});

describe("isOperator", () => {
  const ORIGINAL: unknown = env.ADMIN_USER_IDS;

  afterEach(() => {
    Reflect.set(env, "ADMIN_USER_IDS", ORIGINAL);
  });

  it("admits a configured admin", () => {
    Reflect.set(env, "ADMIN_USER_IDS", "op-1,op-2");

    expect(isOperator("op-2")).toBe(true);
  });

  it("refuses a signed-in runner who is not one", () => {
    Reflect.set(env, "ADMIN_USER_IDS", "op-1");

    expect(isOperator("runner-9")).toBe(false);
  });

  it("refuses a signed-out visitor, even with admins configured", () => {
    Reflect.set(env, "ADMIN_USER_IDS", "op-1");

    expect(isOperator(undefined)).toBe(false);
  });
});

describe("deskToday", () => {
  it("carries the counts and the moment they were read", async () => {
    await queueRow();
    const before = nowSeconds();

    const today = await deskToday();

    expect(today.counts.waiting).toBe(1);
    expect(today.asOf).toBeGreaterThanOrEqual(before);
    expect(today.asOf).toBeLessThanOrEqual(nowSeconds());
  });
});

describe("operatorOrNotFound", () => {
  it("lets an operator through", () => {
    expect(() => {
      operatorOrNotFound({ operator: true });
    }).not.toThrow();
  });

  it("answers anyone else with the router's not-found, never a refusal", () => {
    let thrown: unknown;
    try {
      operatorOrNotFound({ operator: false });
    } catch (error) {
      thrown = error;
    }

    expect(thrown).toBeInstanceOf(NotFoundError);
    // What TanStack's router duck-types on to render a 404.
    expect(thrown).toHaveProperty("isNotFound", true);
  });
});
