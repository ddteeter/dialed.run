import { drizzle } from "drizzle-orm/d1";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { gaveUpUpsert } from "../../src/db/gave-up";
import { user } from "../../src/db/schema-auth";
import {
  cronCheckpoints,
  gaveUp,
  reviewQueue,
  runs,
  userProfiles,
} from "../../src/db/schema-core";
import { env } from "../../src/env";
import { newUlid } from "../../src/lib/ids";
import { nowSeconds } from "../../src/lib/now";
import { deskToday } from "../../src/modules/ops/desk";
import { gaveUpJobs } from "../../src/modules/ops/gave-up";
import { REPORT_HIDES_FLOOR } from "../../src/modules/safety/breakers";

import { queryCounts, type QueryCounts } from "../d1-spy";
import { makeRun, makeUser } from "../feed/helpers";
import { opened } from "../safety/helpers";

/**
 * Design 182: the Desk's Today and Gave up ask D1 the same number of
 * statements for 1 row as for 25. Rows read may grow; the statement count
 * may not.
 */

const core = () => drizzle(env.DIALED_CORE);
const HOUR = 60 * 60;
const DAY = 24 * HOUR;
const ADMINS: unknown = env.ADMIN_USER_IDS;

async function counted<T>(
  read: () => Promise<T>,
): Promise<{ counts: QueryCounts; result: T }> {
  let result: T | undefined;
  const counts = await queryCounts(async () => {
    result = await read();
  });
  if (result === undefined) throw new Error("the read returned nothing");
  return { counts, result };
}

function expectFlat(one: QueryCounts, many: QueryCounts): void {
  expect(many.core).toBe(one.core);
  expect(many.weather).toBe(one.weather);
  expect(many.coreRowsRead).toBeGreaterThan(one.coreRowsRead);
}

async function cleared(): Promise<void> {
  await core().batch([
    core().delete(reviewQueue),
    core().delete(gaveUp),
    core().delete(cronCheckpoints),
    core().delete(user),
    core().delete(userProfiles),
    core().delete(runs),
  ]);
}

/**
 * `n` of everything Today counts or names: Review rows, Gave up rows,
 * and unconfirmed operators on a day the digest skipped them; Today
 * counted.
 */
async function seededToday(n: number, openedAt = nowSeconds() - 2 * HOUR) {
  await cleared();
  await opened("reports", n, openedAt);
  const operators: string[] = [];
  for (let index = 0; index < n; index += 1) {
    await gaveUpUpsert(core(), {
      kind: "weather",
      subjectId: newUlid(),
      reason: "weather stopped.",
      tries: 3,
    });
    const id = `op-${String(index)}`;
    operators.push(id);
    const now = new Date();
    await core()
      .insert(user)
      .values({
        id,
        name: "",
        email: `${id}@example.test`,
        emailVerified: false,
        createdAt: now,
        updatedAt: now,
      });
  }
  Reflect.set(env, "ADMIN_USER_IDS", operators.join(","));
  await core()
    .insert(cronCheckpoints)
    .values({
      cronName: "digest-unconfirmed",
      lastRunAt: Math.floor(nowSeconds() / DAY) * DAY,
    });
  return counted(() => deskToday("op-viewer"));
}

/**
`n` weather jobs that gave up, each on its own runner's run; Gave up counted.
*/
async function seededGaveUp(n: number) {
  await cleared();
  for (let index = 0; index < n; index += 1) {
    const runId = await makeRun({ userId: await makeUser() });
    await gaveUpUpsert(core(), {
      kind: "weather",
      subjectId: runId,
      reason: "weather stopped.",
      tries: 3,
    });
  }
  return counted(async () => gaveUpJobs());
}

beforeEach(cleared);
afterEach(() => {
  Reflect.set(env, "ADMIN_USER_IDS", ADMINS);
});

describe("deskToday", () => {
  it("asks the same for 1 of everything as for 25", async () => {
    const one = await seededToday(1);
    const many = await seededToday(25);

    expect(one.result.counts.waiting).toBe(1);
    expect(many.result.counts.waiting).toBe(25);
    expect(many.result.counts.gaveUp).toBe(25);
    expect(one.result.skipped).toHaveLength(1);
    expect(many.result.skipped).toHaveLength(25);
    expectFlat(one.counts, many.counts);
  });

  // A step, not a slope: once the last hour holds `REPORT_HIDES_FLOOR`
  // (10, src/modules/safety/breakers.ts:69) report holds, the reports
  // breaker reads its baseline's busiest hour too (`reportsCeilingFor`,
  // src/modules/safety/breakers.ts:359) — one statement more, however many
  // rows are past the floor.
  it("asks one more once this hour's report holds pass the breaker's floor", async () => {
    const one = await seededToday(1, nowSeconds());
    const atFloor = await seededToday(REPORT_HIDES_FLOOR, nowSeconds());
    const many = await seededToday(25, nowSeconds());

    expect(many.result.counts.waiting).toBe(25);
    expect(atFloor.counts.core).toBe(one.counts.core + 1);
    expect(many.counts.core).toBe(atFloor.counts.core);
    expect(many.counts.weather).toBe(one.counts.weather);
  });
});

describe("gaveUpJobs", () => {
  // The list, then one batch of five lookups over the page's subjects
  // (`subjectFacts`, src/modules/ops/gave-up.ts:133).
  it("asks 1 + 5 for 1 row and for 25", async () => {
    const one = await seededGaveUp(1);
    const many = await seededGaveUp(25);

    expect(one.result).toHaveLength(1);
    expect(many.result).toHaveLength(25);
    expect(
      many.result.every((job) => job.doing.startsWith("Fetch weather for @")),
    ).toBe(true);
    expect(one.counts.core).toBe(1 + 5);
    expectFlat(one.counts, many.counts);
  });
});
