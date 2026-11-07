import { describe, expect, it } from "vitest";

import { newUlid } from "../../src/lib/ids";
import {
  bellState,
  createNotification,
  listNotifications,
} from "../../src/modules/notifications";
import { notificationsDb } from "../../src/modules/notifications/db";
import { runsAwaitingVerdict } from "../../src/modules/runs";
import { queryCounts } from "../d1-spy";
import { makeRun, NOW } from "../feed/helpers";

/**
 * The notification list and the bell cost the same statements for one
 * row as for twenty-five (design 182, part 1).
 */

/**
 * A runner with `count` runs still owed a verdict, each with its unread
 * kit reminder — the rows the list's "markable" subquery has to judge.
 */
async function runnerOwing(count: number): Promise<string> {
  const userId = newUlid();
  for (let index = 0; index < count; index += 1) {
    const runId = await makeRun({ userId, startedAt: NOW - index * 3600 });
    await createNotification(notificationsDb(), {
      userId,
      kind: "kit_reminder",
      subjectId: runId,
      body: "Add your kit.",
      createdAt: NOW - index,
    });
  }
  return userId;
}

/**
The production wiring (`bellStateFn`): runs' own awaiting set, bound.
*/
function awaitingFor(userId: string) {
  return async (limit: number) =>
    runsAwaitingVerdict(notificationsDb(), userId, limit);
}

describe("listNotifications", () => {
  it("reads 1 and 25 notifications in the same statements", async () => {
    const small = await runnerOwing(1);
    let listed = 0;
    const one = await queryCounts(async () => {
      const result = await listNotifications(notificationsDb(), small);
      listed = result.length;
    });
    expect(listed).toBe(1);

    const large = await runnerOwing(25);
    const twentyFive = await queryCounts(async () => {
      const result = await listNotifications(notificationsDb(), large);
      listed = result.length;
    });
    expect(listed).toBe(25);

    expect(one.core).toBe(1);
    expect(twentyFive.core).toBe(one.core);
    expect(twentyFive.weather).toBe(one.weather);
    expect(twentyFive.coreRowsRead).toBeGreaterThan(one.coreRowsRead);
  });
});

describe("bellState", () => {
  it("reads 1 and 25 unread rows and owed runs in the same statements", async () => {
    // Two: the unread count, and the awaiting set read one past
    // BELL_NUMBER_CAP = 9 (src/modules/notifications/bell-cap.ts:11).
    const small = await runnerOwing(1);
    let state = { unreadCount: 0, verdictsWaiting: 0 };
    const one = await queryCounts(async () => {
      state = await bellState(notificationsDb(), small, awaitingFor(small));
    });
    expect(state).toStrictEqual({ unreadCount: 1, verdictsWaiting: 1 });

    const large = await runnerOwing(25);
    const twentyFive = await queryCounts(async () => {
      state = await bellState(notificationsDb(), large, awaitingFor(large));
    });
    expect(state).toStrictEqual({ unreadCount: 25, verdictsWaiting: 10 });

    expect(one.core).toBe(2);
    expect(twentyFive.core).toBe(one.core);
    expect(twentyFive.weather).toBe(one.weather);
    expect(twentyFive.coreRowsRead).toBeGreaterThan(one.coreRowsRead);
  });
});
