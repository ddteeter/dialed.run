import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/d1";
import { afterEach, describe, expect, it, vi } from "vitest";

import { cronCheckpoints, runs } from "../../src/db/schema-core";
import { env } from "../../src/env";
import { newUlid, type Ulid } from "../../src/lib/ids";
import { retryPendingWeather } from "../../src/modules/weather";
import { handleScheduled } from "../../src/modules/ops";
import { mockVisualCrossing } from "./fixtures/visual-crossing-observation";
import { gaveUpUpsert } from "../../src/db/gave-up";
import { nowSeconds } from "../../src/lib/now";
import { gaveUpRow } from "../gave-up-rows";

const HOUR = 3600;

function coreDb() {
  return drizzle(env.DIALED_CORE);
}

async function insertPendingRun(
  overrides: Partial<typeof runs.$inferInsert>,
): Promise<Ulid> {
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
  const [row] = await coreDb()
    .select()
    .from(runs)
    .where(eq(runs.id, runId))
    .limit(1);
  return row?.weatherStatus;
}

function nothing(): void {
  /*
   * The point is to do nothing.
   */
}

function urlOf(input: RequestInfo | URL): string {
  if (typeof input === "string") return input;
  return input instanceof URL ? input.href : input.url;
}

function silenceWarn() {
  return vi.spyOn(console, "warn").mockImplementation(nothing);
}

function mockFetchJson(body: unknown, status = 200) {
  return vi
    .spyOn(globalThis, "fetch")
    .mockResolvedValue(Response.json(body, { status }));
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe("retryPendingWeather (103, hourly cron)", () => {
  it("pending -> success: a claimed run resolves on this pass", async () => {
    const runId = await insertPendingRun({ lat: 60.1, lng: 20.1 });
    mockVisualCrossing();

    const result = await retryPendingWeather();

    expect(result.attached).toBeGreaterThanOrEqual(1);
    expect(await statusOf(runId)).toBe("attached");
  });

  it("pending -> exhausted: past the 5h window with no resolution becomes failed", async () => {
    const sixHoursAgo = nowSeconds() - 6 * HOUR;
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
    const oneHourAgo = nowSeconds() - 1 * HOUR;
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
    mockVisualCrossing();

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
    const fetchSpy = mockVisualCrossing();

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
      startedAt: nowSeconds() - HOUR,
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
      startedAt: nowSeconds() - HOUR,
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
      startedAt: nowSeconds() - 6 * HOUR,
    });
    mockFetchJson({ unexpected: "shape" });
    const warn = silenceWarn();

    await retryPendingWeather();

    // The only trace an operator gets that a run stopped retrying.
    expect(warn).toHaveBeenCalledWith(expect.stringContaining("exhausted"), {
      runIds: [runId],
    });
  });

  it("gives up exactly at five hours, not a second before", async () => {
    // `>=` rather than `>`: a run that entered the window exactly
    // FAIL_AFTER_SECONDS ago has had its five hours. One second younger
    // has not.
    //
    // The clock is pinned for the whole test, and that is what makes the
    // assertion mean anything. The boundary is only `>=` rather than `>`
    // at *exactly* FAIL_AFTER_SECONDS, so the age the cron computes has to
    // be exactly that — and it reads its own `Date.now()` some
    // milliseconds after this test reads one. On a fast machine the two
    // land in the same second and the mutant dies; on a loaded CI runner
    // the drift makes the age strictly greater, both operators agree, and
    // the mutant survives. It did, on CI, on a run where nothing about
    // this code had changed.
    const now = nowSeconds();
    vi.spyOn(Date, "now").mockReturnValue(now * 1000);
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

describe("the Desk's Gave up (R-119)", () => {
  it("lists a run the cron gave up on, with the window's hours as its tries", async () => {
    silenceWarn();
    const runId = await insertPendingRun({
      lat: 63.1,
      lng: 23.1,
      startedAt: nowSeconds() - 5.5 * HOUR,
    });
    mockFetchJson({ unexpected: "shape" });

    await retryPendingWeather();

    const row = await gaveUpRow("weather", runId);
    expect(row?.rawError).toBeNull();
    expect(row).toMatchObject({
      reason:
        "No weather came back for this run in five hours of hourly tries.",
      tries: 5,
    });
  });

  it("does not list a run still inside the window", async () => {
    silenceWarn();
    const runId = await insertPendingRun({
      lat: 64.1,
      lng: 24.1,
      startedAt: nowSeconds() - HOUR,
    });
    mockFetchJson({ unexpected: "shape" });

    await retryPendingWeather();

    expect(await gaveUpRow("weather", runId)).toBeUndefined();
  });

  it("takes a run off the list once its conditions resolve", async () => {
    const runId = await insertPendingRun({ lat: 65.1, lng: 25.1 });
    await gaveUpUpsert(coreDb(), {
      kind: "weather",
      subjectId: runId,
      reason: "x",
      tries: 5,
    });
    mockVisualCrossing();

    await retryPendingWeather();

    expect(await statusOf(runId)).toBe("attached");
    expect(await gaveUpRow("weather", runId)).toBeUndefined();
  });

  it("keeps a run on the list while it is only pending again", async () => {
    silenceWarn();
    const runId = await insertPendingRun({
      lat: 66.1,
      lng: 26.1,
      startedAt: nowSeconds() - HOUR,
    });
    await gaveUpUpsert(coreDb(), {
      kind: "weather",
      subjectId: runId,
      reason: "x",
      tries: 5,
    });
    mockFetchJson({ unexpected: "shape" });

    await retryPendingWeather();

    expect(await statusOf(runId)).toBe("pending");
    expect(await gaveUpRow("weather", runId)).toBeDefined();
  });
});

describe("a give-up after the window (R-119): a Retry is one try, not five", () => {
  const LATE_REASON =
    "No weather came back for this run on its latest try, made after its five-hour window had closed.";

  it("counts one try for a run failed again after an operator's Retry, and says so", async () => {
    // The Desk's Retry clears the row and puts the run back to `pending`;
    // the next pass finds it hours past its window and fails it at once.
    silenceWarn();
    const runId = await insertPendingRun({
      lat: 69.1,
      lng: 29.1,
      startedAt: nowSeconds() - 9 * HOUR,
    });
    mockFetchJson({ unexpected: "shape" });

    await retryPendingWeather();

    expect(await gaveUpRow("weather", runId)).toMatchObject({
      reason: LATE_REASON,
      tries: 1,
    });
  });

  it("adds one try to a run still listed when it fails again", async () => {
    silenceWarn();
    const runId = await insertPendingRun({
      lat: 70.1,
      lng: 30.1,
      startedAt: nowSeconds() - 9 * HOUR,
    });
    await gaveUpUpsert(coreDb(), {
      kind: "weather",
      subjectId: runId,
      reason:
        "No weather came back for this run in five hours of hourly tries.",
      tries: 5,
    });
    mockFetchJson({ unexpected: "shape" });

    await retryPendingWeather();

    expect(await gaveUpRow("weather", runId)).toMatchObject({
      reason: LATE_REASON,
      tries: 6,
    });
  });

  it("draws the line at six hours: the window's five tries before it, one after", async () => {
    const now = nowSeconds();
    vi.spyOn(Date, "now").mockReturnValue(now * 1000);
    silenceWarn();
    mockFetchJson({ unexpected: "shape" });

    await clearPendingRuns();
    const justInside = await insertPendingRun({
      lat: 71.1,
      lng: 31.1,
      startedAt: now - 6 * HOUR + 1,
    });
    await retryPendingWeather();
    const inside = await gaveUpRow("weather", justInside);
    expect(inside?.tries).toBe(5);

    await clearPendingRuns();
    const atTheLine = await insertPendingRun({
      lat: 72.1,
      lng: 32.1,
      startedAt: now - 6 * HOUR,
    });
    await retryPendingWeather();
    const atLine = await gaveUpRow("weather", atTheLine);
    expect(atLine?.tries).toBe(1);
  });
});

describe("the cap fails only what is still pending", () => {
  it("neither fails nor lists a run past the window that this pass attached", async () => {
    await clearPendingRuns();
    const runId = await insertPendingRun({
      lat: 60.2,
      lng: 20.2,
      startedAt: nowSeconds() - 9 * HOUR,
    });
    mockVisualCrossing();
    const warn = silenceWarn();

    const result = await retryPendingWeather();

    expect(result.failed).toBe(0);
    expect(await statusOf(runId)).toBe("attached");
    expect(await gaveUpRow("weather", runId)).toBeUndefined();
    expect(warn).not.toHaveBeenCalledWith(
      expect.stringContaining("exhausted"),
      expect.anything(),
    );
  });

  it("leaves a band saved since the read alone: not failed, not listed", async () => {
    // The race: the runner saves a band (`manual`) after this pass has
    // tried their run but before its cap. The pass tries runs oldest
    // first, so the band lands while it is trying a younger one.
    await clearPendingRuns();
    const banded = await insertPendingRun({
      lat: 60.3,
      lng: 20.3,
      startedAt: nowSeconds() - 10 * HOUR,
    });
    await insertPendingRun({
      lat: 60.35,
      lng: 20.35,
      startedAt: nowSeconds() - 9 * HOUR,
    });
    vi.spyOn(globalThis, "fetch").mockImplementation(async (input) => {
      if (urlOf(input).includes("60.35")) {
        await coreDb()
          .update(runs)
          .set({ weatherStatus: "manual" })
          .where(eq(runs.id, banded));
      }
      return Response.json({ unexpected: "shape" });
    });
    silenceWarn();

    const result = await retryPendingWeather();

    expect(result.failed).toBe(1);
    expect(await statusOf(banded)).toBe("manual");
    expect(await gaveUpRow("weather", banded)).toBeUndefined();
  });

  it("keeps another run's row when it fails one beside it", async () => {
    await clearPendingRuns();
    silenceWarn();
    const failing = await insertPendingRun({
      lat: 60.4,
      lng: 20.4,
      startedAt: nowSeconds() - 5.5 * HOUR,
    });
    mockFetchJson({ unexpected: "shape" });

    await retryPendingWeather();

    expect(await statusOf(failing)).toBe("failed");
    expect(await gaveUpRow("weather", failing)).toBeDefined();
  });
});
