import { and, eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";

import { rateLimits, runs } from "../../src/db/schema-core";
import { controlRefusalMessage } from "../../src/lib/control-refusal";
import { newUlid } from "../../src/lib/ids";
import { nowSeconds } from "../../src/lib/now";
import { coreDb } from "../../src/modules/runs/core-db";
import {
  MANUAL_RUNS_PER_DAY,
  MANUAL_RUN_REFUSALS,
  countRuns,
  createManualRun,
  didRetryRunWeather,
} from "../../src/modules/runs/service";
import { countRow } from "../rate-limit-rows";

const draft = {
  title: "Morning run",
  startedAt: 1_755_000_000,
  durationS: 1800,
  distanceM: 5000,
  indoor: true,
};

async function usedToday(userId: string, count: number) {
  await coreDb()
    .insert(rateLimits)
    .values(countRow("manual-run-runner", userId, count, nowSeconds()));
}

async function countOf(userId: string): Promise<number | undefined> {
  const [row] = await coreDb()
    .select({ count: rateLimits.count })
    .from(rateLimits)
    .where(
      and(
        eq(rateLimits.kind, "manual-run-runner"),
        eq(rateLimits.subject, userId),
      ),
    );
  return row?.count;
}

async function refusalOf(work: Promise<unknown>): Promise<string | undefined> {
  try {
    await work;
  } catch (error: unknown) {
    return controlRefusalMessage(error);
  }
  return undefined;
}

describe("a runner's day of manual runs", () => {
  it("is thirty, the owner's number", () => {
    expect(MANUAL_RUNS_PER_DAY).toBe(30);
  });

  it("takes the day's last run and refuses the one after, storing nothing", async () => {
    const db = coreDb();
    const userId = newUlid();
    await usedToday(userId, MANUAL_RUNS_PER_DAY - 1);

    await createManualRun(db, userId, draft, newUlid());
    const over = createManualRun(db, userId, draft, newUlid());
    expect(await refusalOf(over)).toBe(
      "That's 30 runs today. You can log more tomorrow.",
    );
    expect(await countRuns(db, userId)).toBe(1);
  });

  it("counts every new run, with or without a key", async () => {
    const db = coreDb();
    const userId = newUlid();
    await createManualRun(db, userId, draft, newUlid());
    await createManualRun(db, userId, draft);
    expect(await countOf(userId)).toBe(2);
  });

  it("returns a repeat's run at the limit without counting it", async () => {
    const db = coreDb();
    const userId = newUlid();
    const key = newUlid();
    const first = await createManualRun(db, userId, draft, key);
    await coreDb()
      .update(rateLimits)
      .set({ count: MANUAL_RUNS_PER_DAY })
      .where(eq(rateLimits.subject, userId));

    expect(await createManualRun(db, userId, draft, key)).toStrictEqual(first);
    expect(await countOf(userId)).toBe(MANUAL_RUNS_PER_DAY);
  });

  it("counts each runner's day apart", async () => {
    const db = coreDb();
    const full = newUlid();
    await usedToday(full, MANUAL_RUNS_PER_DAY);
    const refused = createManualRun(db, full, draft, newUlid());
    expect(await refusalOf(refused)).toBe(MANUAL_RUN_REFUSALS.log);
    const other = newUlid();
    await createManualRun(db, other, draft, newUlid());
    expect(await countRuns(db, other)).toBe(1);
    expect(await countRuns(db, full)).toBe(0);
  });
});

async function failedOutdoorRun(userId: string): Promise<string> {
  const id = newUlid();
  await coreDb().insert(runs).values({
    id,
    userId,
    source: "manual",
    startedAt: 1_755_000_000,
    durationS: 1800,
    distanceM: 5000,
    lat: 44.98,
    lng: -93.27,
    indoor: false,
    title: "Morning run",
    weatherStatus: "failed",
  });
  return id;
}

describe("Try again on a run's weather spends the same count", () => {
  it("refuses past the day's count and leaves the run as it was", async () => {
    const db = coreDb();
    const userId = newUlid();
    const runId = await failedOutdoorRun(userId);
    await usedToday(userId, MANUAL_RUNS_PER_DAY);
    let asked = 0;
    const weather = {
      attach: () => {
        asked += 1;
        return Promise.resolve("attached");
      },
    };

    expect(
      await refusalOf(didRetryRunWeather(db, weather, userId, runId)),
    ).toBe(MANUAL_RUN_REFUSALS.retry);
    expect(MANUAL_RUN_REFUSALS.retry).toBe(
      "That's 30 tries today. You can try again tomorrow.",
    );
    expect(asked).toBe(0);
    const [run] = await db
      .select({ weatherStatus: runs.weatherStatus })
      .from(runs)
      .where(eq(runs.id, runId));
    expect(run?.weatherStatus).toBe("failed");
  });

  it("counts one try within the day", async () => {
    const db = coreDb();
    const userId = newUlid();
    const runId = await failedOutdoorRun(userId);
    const weather = { attach: () => Promise.resolve("attached") };

    expect(await didRetryRunWeather(db, weather, userId, runId)).toBe(true);
    expect(await countOf(userId)).toBe(1);
  });

  it("counts nothing for a run it may not be offered for", async () => {
    const db = coreDb();
    const userId = newUlid();
    const weather = { attach: () => Promise.resolve("attached") };

    expect(await didRetryRunWeather(db, weather, userId, newUlid())).toBe(
      false,
    );
    expect(await countOf(userId)).toBeUndefined();
  });
});
