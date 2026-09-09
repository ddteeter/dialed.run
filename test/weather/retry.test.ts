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
      indoor: false,
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

function nothing(): void {
  /*
   * The point is to do nothing.
   */
}

function silenceWarn() {
  return vi.spyOn(console, "warn").mockImplementation(nothing);
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

/**
 * The cron's own arithmetic, which is where its survivors were.
 *
 * The three tests above assert the happy path and the two ends of the age
 * window, but they run against a shared database and so lean on
 * `toBeGreaterThanOrEqual`. That is exactly the assertion a mutant slips
 * through: the counts it returns could be made up, the exhaustion warning
 * could be silenced, and the boundary could move by a second, with all
 * three still green.
 *
 * These clear the pending rows first so the counts are exact.
 */
async function clearPendingRuns(): Promise<void> {
  await coreDb().delete(runs).where(eq(runs.weatherStatus, "pending"));
}

describe("retryPendingWeather counts what it actually did", () => {
  it("returns three zeros when nothing is pending, and asks the provider nothing", async () => {
    await clearPendingRuns();
    const fetchSpy = mockFetchJson(visualCrossingObservationFixture);

    expect(await retryPendingWeather()).toStrictEqual({
      claimed: 0,
      attached: 0,
      failed: 0,
    });
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("counts a claimed-but-unresolved run as claimed, not attached", async () => {
    await clearPendingRuns();
    // Entered its window an hour ago: still inside the five-hour retry
    // budget, so it stays pending rather than being given up on.
    const runId = await insertPendingRun({
      lat: 64.1,
      lng: 24.1,
      startedAt: Math.floor(Date.now() / 1000) - HOUR,
    });
    mockFetchJson({ unexpected: "shape" });

    // Claimed one, attached none: the run is still pending and inside its
    // window, so nothing failed either.
    expect(await retryPendingWeather()).toStrictEqual({
      claimed: 1,
      attached: 0,
      failed: 0,
    });
    expect(await statusOf(runId)).toBe("pending");
  });

  it("does not warn about exhaustion when nothing was exhausted", async () => {
    await clearPendingRuns();
    await insertPendingRun({
      lat: 65.1,
      lng: 25.1,
      startedAt: Math.floor(Date.now() / 1000) - HOUR,
    });
    mockFetchJson({ unexpected: "shape" });
    const warn = silenceWarn();

    await retryPendingWeather();

    expect(warn).not.toHaveBeenCalledWith(
      expect.stringContaining("exhausted"),
      expect.anything(),
    );
  });

  it("names the runs it gave up on", async () => {
    await clearPendingRuns();
    const runId = await insertPendingRun({
      lat: 66.1,
      lng: 26.1,
      startedAt: Math.floor(Date.now() / 1000) - 6 * HOUR,
    });
    mockFetchJson({ unexpected: "shape" });
    const warn = silenceWarn();

    await retryPendingWeather();

    // The only trace an operator gets that a run stopped retrying.
    expect(warn).toHaveBeenCalledWith(
      expect.stringContaining("exhausted"),
      { runIds: [runId] },
    );
  });

  it("gives up exactly at five hours, not a second before", async () => {
    // `>=` rather than `>`: a run that entered the window exactly
    // FAIL_AFTER_SECONDS ago has had its five hours. One second younger
    // has not.
    const now = Math.floor(Date.now() / 1000);
    const FAIL_AFTER = 5 * HOUR;

    await clearPendingRuns();
    const atTheLimit = await insertPendingRun({
      lat: 67.1,
      lng: 27.1,
      startedAt: now - FAIL_AFTER,
    });
    mockFetchJson({ unexpected: "shape" });
    const exhausted = await retryPendingWeather();
    expect(exhausted.failed).toBe(1);
    expect(await statusOf(atTheLimit)).toBe("failed");

    await clearPendingRuns();
    const justInside = await insertPendingRun({
      lat: 68.1,
      lng: 28.1,
      startedAt: now - FAIL_AFTER + 2,
    });
    const stillTrying = await retryPendingWeather();
    expect(stillTrying.failed).toBe(0);
    expect(await statusOf(justInside)).toBe("pending");
  });
});
