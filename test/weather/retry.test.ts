import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/d1";
import { afterEach, describe, expect, it, vi } from "vitest";

import { cronCheckpoints, imports, runs } from "../../src/db/schema-core";
import { env } from "../../src/env";
import { newUlid, type Ulid } from "../../src/lib/ids";
import { retryPendingWeather } from "../../src/modules/weather";
import { handleScheduled } from "../../src/modules/ops";
import {
  askedEpochs,
  mockVisualCrossing,
  pinNow,
} from "./fixtures/visual-crossing-observation";
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

/**
 * A start for a thirty-minute run whose retry window opened between
 * `hours` and `hours + 1` ago.
 *
 * The window opens when the run's last hour settles (D-156): two hours
 * after that hour ends. A run starting on the hour `S` has one hour, which
 * ends at `S + 1h` and settles at `S + 3h` — always on an hour boundary,
 * which is why the age can only be pinned to within an hour here. The
 * tests that need an exact boundary pin the clock instead.
 */
function startedForWindowAge(hours: number): number {
  const opens = Math.floor((nowSeconds() - hours * HOUR) / HOUR) * HOUR;
  return opens - 3 * HOUR;
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
    const sixHoursAgo = startedForWindowAge(5);
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
    const oneHourAgo = startedForWindowAge(1);
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
      startedAt: startedForWindowAge(1),
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
      startedAt: startedForWindowAge(1),
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
      startedAt: startedForWindowAge(5),
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
    //
    // The window opens when the run's last hour settles (D-156), so the
    // start is fixed on an hour and the clock is what moves.
    const FAIL_AFTER = 5 * HOUR;
    const startedAt = startedForWindowAge(FAIL_AFTER / HOUR);
    const opens = startedAt + 3 * HOUR;
    mockFetchJson({ unexpected: "shape" });

    await clearPendingRuns();
    vi.spyOn(Date, "now").mockReturnValue((opens + FAIL_AFTER) * 1000);
    const atTheLimit = await insertPendingRun({
      lat: 67.1,
      lng: 27.1,
      startedAt,
    });
    const exhausted = await retryPendingWeather();
    expect(exhausted.failed).toBe(1);
    expect(await statusOf(atTheLimit)).toBe("failed");

    await clearPendingRuns();
    vi.spyOn(Date, "now").mockReturnValue((opens + FAIL_AFTER - 1) * 1000);
    const justInside = await insertPendingRun({
      lat: 68.1,
      lng: 28.1,
      startedAt,
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
      startedAt: startedForWindowAge(5),
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
      startedAt: startedForWindowAge(1),
    });
    mockFetchJson({ unexpected: "shape" });

    await retryPendingWeather();

    expect(await gaveUpRow("weather", runId)).toBeUndefined();
  });

  it("takes a run off the list once its conditions resolve", async () => {
    // Inside the window, so the cap's own clean-up never reaches it: the
    // resolve is what takes it off.
    const runId = await insertPendingRun({
      lat: 65.1,
      lng: 25.1,
      startedAt: startedForWindowAge(1),
    });
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
      startedAt: startedForWindowAge(1),
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
      startedAt: startedForWindowAge(9),
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
      startedAt: startedForWindowAge(9),
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
    const startedAt = startedForWindowAge(6);
    const opens = startedAt + 3 * HOUR;
    silenceWarn();
    mockFetchJson({ unexpected: "shape" });

    await clearPendingRuns();
    vi.spyOn(Date, "now").mockReturnValue((opens + 6 * HOUR - 1) * 1000);
    const justInside = await insertPendingRun({
      lat: 71.1,
      lng: 31.1,
      startedAt,
    });
    await retryPendingWeather();
    const inside = await gaveUpRow("weather", justInside);
    expect(inside?.tries).toBe(5);

    await clearPendingRuns();
    vi.spyOn(Date, "now").mockReturnValue((opens + 6 * HOUR) * 1000);
    const atTheLine = await insertPendingRun({
      lat: 72.1,
      lng: 32.1,
      startedAt,
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
      startedAt: startedForWindowAge(9),
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
      startedAt: startedForWindowAge(10),
    });
    await insertPendingRun({
      lat: 60.35,
      lng: 20.35,
      startedAt: startedForWindowAge(9),
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
      startedAt: startedForWindowAge(5),
    });
    mockFetchJson({ unexpected: "shape" });

    await retryPendingWeather();

    expect(await statusOf(failing)).toBe("failed");
    expect(await gaveUpRow("weather", failing)).toBeDefined();
  });
});

/**
 * D-156 from the cron's side: it fetches only settled hours too, and its
 * five-hour window opens when the run's last hour settles, so a long run
 * is never given up on before its last hour could be asked for.
 *
 * A run starting on the hour `S` and lasting two hours spans `S`, `S+1h`
 * and `S+2h`; the last ends at `S+3h` and settles at `S+5h`.
 */
describe("the cron waits for a run's hours to settle (D-156)", () => {
  const S = 1_768_485_600;
  const LAST_SETTLES = S + 5 * HOUR;

  it("leaves a run wholly inside the settling margin pending, asking for nothing", async () => {
    await clearPendingRuns();
    pinNow(S + 3 * HOUR - 1);
    const fetchSpy = mockVisualCrossing();
    const runId = await insertPendingRun({
      lat: 73.1,
      lng: 33.1,
      durationS: 2 * HOUR,
    });

    expect(await retryPendingWeather()).toStrictEqual({
      claimed: 1,
      attached: 0,
      failed: 0,
    });
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(await statusOf(runId)).toBe("pending");
  });

  it("fills the last hour once it settles, and not a second before", async () => {
    await clearPendingRuns();
    const runId = await insertPendingRun({
      lat: 73.2,
      lng: 33.2,
      durationS: 2 * HOUR,
    });

    pinNow(LAST_SETTLES - 1);
    const before = mockVisualCrossing();
    expect(await passCount("attached")).toBe(0);
    expect(askedEpochs(before)).toStrictEqual([S, S + HOUR]);
    expect(await statusOf(runId)).toBe("pending");
    vi.restoreAllMocks();

    pinNow(LAST_SETTLES);
    const after = mockVisualCrossing();
    expect(await passCount("attached")).toBe(1);
    expect(askedEpochs(after)).toStrictEqual([S + 2 * HOUR]);
    expect(await statusOf(runId)).toBe("attached");
  });

  it("gives up five hours after the last hour settles, not five after the start", async () => {
    // Counted from its start, this run's window would have closed at
    // S+5h, the moment its last hour first became fetchable.
    mockFetchJson({ unexpected: "shape" });
    silenceWarn();

    await clearPendingRuns();
    pinNow(LAST_SETTLES + 5 * HOUR - 1);
    const inside = await insertPendingRun({
      lat: 73.3,
      lng: 33.3,
      durationS: 2 * HOUR,
    });
    expect(await passCount("failed")).toBe(0);
    expect(await statusOf(inside)).toBe("pending");

    await clearPendingRuns();
    pinNow(LAST_SETTLES + 5 * HOUR);
    const atTheLimit = await insertPendingRun({
      lat: 73.4,
      lng: 33.4,
      durationS: 2 * HOUR,
    });
    expect(await passCount("failed")).toBe(1);
    expect(await gaveUpRow("weather", atTheLimit)).toMatchObject({
      tries: 5,
    });
  });

  it("opens the window at the sixth hour for a run longer than the six it samples", async () => {
    // Ten hours long, but only six are sampled (S to S+5h): the last
    // settles at S+8h, so the window closes at S+13h.
    mockFetchJson({ unexpected: "shape" });
    silenceWarn();

    await clearPendingRuns();
    pinNow(S + 13 * HOUR - 1);
    await insertPendingRun({ lat: 73.5, lng: 33.5, durationS: 10 * HOUR });
    expect(await passCount("failed")).toBe(0);

    await clearPendingRuns();
    pinNow(S + 13 * HOUR);
    await insertPendingRun({ lat: 73.6, lng: 33.6, durationS: 10 * HOUR });
    expect(await passCount("failed")).toBe(1);
  });

  it("opens the window on arrival for a file uploaded long after its hours settled", async () => {
    mockFetchJson({ unexpected: "shape" });
    silenceWarn();
    const arrived = S + 100 * HOUR;

    await clearPendingRuns();
    pinNow(arrived + 5 * HOUR - 1);
    const inside = await insertPendingRun({ lat: 73.7, lng: 33.7 });
    await insertImportFor(inside, arrived);
    expect(await passCount("failed")).toBe(0);

    await clearPendingRuns();
    pinNow(arrived + 5 * HOUR);
    const atTheLimit = await insertPendingRun({ lat: 73.8, lng: 33.8 });
    await insertImportFor(atTheLimit, arrived);
    expect(await passCount("failed")).toBe(1);
  });
});

/**
 * One pass of the cron, and one of its counts.
 */
async function passCount(
  count: "claimed" | "attached" | "failed",
): Promise<number> {
  const result = await retryPendingWeather();
  return result[count];
}

async function insertImportFor(runId: Ulid, createdAt: number): Promise<void> {
  await coreDb()
    .insert(imports)
    .values({
      id: newUlid(),
      userId: newUlid(),
      r2Key: `imports/${runId}.gpx`,
      status: "done",
      runId,
      createdAt,
    });
}
