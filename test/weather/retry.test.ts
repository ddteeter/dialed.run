import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/d1";
import { afterEach, describe, expect, it, vi } from "vitest";

import { cronCheckpoints, runs } from "../../src/db/schema-core";
import { env } from "../../src/env";
import { newUlid, type Ulid } from "../../src/lib/ids";
import { retryPendingWeather } from "../../src/modules/weather";
import { handleScheduled } from "../../src/modules/ops";
import { visualCrossingObservationFixture } from "./fixtures/visual-crossing-observation";

const HOUR = 3600;

function coreDb() {
  return drizzle(env.DIALED_CORE);
}

async function insertPendingRun(overrides: Partial<typeof runs.$inferInsert>): Promise<Ulid> {
  const id = newUlid();
  await coreDb()
    .insert(runs)
    .values({
      id,
      userId: newUlid(),
      source: "manual",
      startedAt: 1_768_485_600,
      durationS: 1800,
      distanceM: 5000,
      indoor: 0,
      title: "Retry test run",
      weatherStatus: "pending",
      ...overrides,
    });
  return id;
}

async function statusOf(runId: Ulid): Promise<string | undefined> {
  const [row] = await coreDb().select().from(runs).where(eq(runs.id, runId)).limit(1);
  return row?.weatherStatus;
}

function mockFetchJson(body: unknown, status = 200) {
  return vi.spyOn(globalThis, "fetch").mockResolvedValue(Response.json(body, { status }));
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe("retryPendingWeather (103, hourly cron)", () => {
  it("pending -> success: a claimed run resolves on this pass", async () => {
    const runId = await insertPendingRun({ lat: 60.1, lng: 20.1 });
    mockFetchJson(visualCrossingObservationFixture);

    const result = await retryPendingWeather();

    expect(result.attached).toBeGreaterThanOrEqual(1);
    expect(await statusOf(runId)).toBe("attached");
  });

  it("pending -> exhausted: past the 5h window with no resolution becomes failed", async () => {
    const sixHoursAgo = Math.floor(Date.now() / 1000) - 6 * HOUR;
    const runId = await insertPendingRun({
      lat: 61.1,
      lng: 21.1,
      startedAt: sixHoursAgo,
    });
    mockFetchJson({ unexpected: "shape" }); // provider keeps failing

    const result = await retryPendingWeather();

    expect(result.failed).toBe(1);
    expect(await statusOf(runId)).toBe("failed");
  });

  it("a run within the 5h window stays pending rather than failing early", async () => {
    const oneHourAgo = Math.floor(Date.now() / 1000) - 1 * HOUR;
    const runId = await insertPendingRun({
      lat: 62.1,
      lng: 22.1,
      startedAt: oneHourAgo,
    });
    mockFetchJson({ unexpected: "shape" });

    const result = await retryPendingWeather();

    expect(result.failed).toBe(0);
    expect(await statusOf(runId)).toBe("pending");
  });
});

describe("ops.handleScheduled dispatches the weather retry cron", () => {
  it("writes its own heartbeat and reattaches pending runs", async () => {
    const runId = await insertPendingRun({ lat: 63.1, lng: 23.1 });
    mockFetchJson(visualCrossingObservationFixture);

    await handleScheduled({ cron: "0 * * * *" } as ScheduledController);

    const [checkpoint] = await coreDb()
      .select()
      .from(cronCheckpoints)
      .where(eq(cronCheckpoints.cronName, "weather-retry"));
    expect(checkpoint).toBeDefined();
    expect(await statusOf(runId)).toBe("attached");
  });
});
