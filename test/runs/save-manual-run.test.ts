import { eq } from "drizzle-orm";
import { afterEach, describe, expect, it, vi } from "vitest";

import { runs } from "../../src/db/schema-core";
import { newUlid } from "../../src/lib/ids";
import type { Ulid } from "../../src/lib/ids";
import type { RunDraft } from "../../src/lib/contracts";
import { coreDb } from "../../src/modules/runs/core-db";
import {
  getRunSummary,
  saveManualRun,
  type WeatherOnSave,
} from "../../src/modules/runs/service";
import { attachObservation } from "../../src/modules/weather";
import { mockVisualCrossing } from "../weather/fixtures/visual-crossing-observation";

// 2026-01-15 07:00 UTC, an hour the Visual Crossing fixture answers for.
const FIXTURE_HOUR = 1_768_485_600;

const outdoor: RunDraft = {
  startedAt: FIXTURE_HOUR,
  durationS: 1800,
  distanceM: 5000,
  indoor: false,
  lat: 46.5,
  lng: -94.5,
  title: "Morning run",
};

/**
What R1's save was handed, and what it did with it.
*/
function recordingWeather(attach: WeatherOnSave["attach"]) {
  const kept: Promise<unknown>[] = [];
  const asked: Ulid[] = [];
  const reports: { error: unknown; context: Record<string, string> }[] = [];
  return {
    kept,
    asked,
    reports,
    weather: {
      attach: (runId: Ulid) => {
        asked.push(runId);
        return attach(runId);
      },
      keepAlive: (work: Promise<unknown>) => {
        kept.push(work);
      },
      report: (error: unknown, context: Record<string, string>) => {
        reports.push({ error, context });
      },
    } satisfies WeatherOnSave,
  };
}

async function statusOf(runId: string) {
  const [row] = await coreDb()
    .select({ weatherStatus: runs.weatherStatus })
    .from(runs)
    .where(eq(runs.id, runId));
  return row?.weatherStatus;
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe("saveManualRun: R1's save asks for the weather after the answer", () => {
  it("hands the attempt to keepAlive rather than waiting on it", async () => {
    // An attempt that has not settled when the save answers.
    const attempt = Promise.withResolvers<string>();
    const fake = recordingWeather(() => attempt.promise);

    const created = await saveManualRun(
      coreDb(),
      newUlid(),
      outdoor,
      undefined,
      fake.weather,
    );

    expect(created.weatherStatus).toBe("pending");
    expect(fake.asked).toStrictEqual([created.id]);
    expect(fake.kept).toHaveLength(1);
    expect(await statusOf(created.id)).toBe("pending");
    attempt.resolve("pending");
    await Promise.all(fake.kept);
  });

  it("still saves when the attempt throws, and reports it with the run", async () => {
    const userId = newUlid();
    const failure = new Error("weather is down");
    const fake = recordingWeather(() => Promise.reject(failure));

    const created = await saveManualRun(
      coreDb(),
      userId,
      outdoor,
      undefined,
      fake.weather,
    );
    // The kept work never rejects (law 5): a rejection here would be an
    // unhandled one in the Worker.
    await expect(Promise.all(fake.kept)).resolves.toBeDefined();

    expect(fake.reports).toStrictEqual([
      {
        error: failure,
        context: { surface: "runs.attachOnSave", runId: created.id, userId },
      },
    ]);
    // The marker the hourly retry re-drives.
    expect(await statusOf(created.id)).toBe("pending");
  });

  it("reports nothing when the attempt succeeds", async () => {
    const fake = recordingWeather(() => Promise.resolve("attached"));

    await saveManualRun(coreDb(), newUlid(), outdoor, undefined, fake.weather);
    await Promise.all(fake.kept);

    expect(fake.reports).toStrictEqual([]);
  });

  it("asks for nothing for a run with no weather to have", async () => {
    const fake = recordingWeather(() => Promise.resolve("attached"));

    const indoor = await saveManualRun(
      coreDb(),
      newUlid(),
      { ...outdoor, indoor: true },
      undefined,
      fake.weather,
    );
    // No coordinates and no home place: R2b's run, not the weather's.
    const placeless = await saveManualRun(
      coreDb(),
      newUlid(),
      { ...outdoor, lat: undefined, lng: undefined },
      undefined,
      fake.weather,
    );

    expect(indoor.weatherStatus).toBe("none");
    expect(placeless.weatherStatus).toBe("failed");
    expect(fake.asked).toStrictEqual([]);
    expect(fake.kept).toStrictEqual([]);
  });

  it("passes the idempotency key through, so a resubmission is the same run", async () => {
    const userId = newUlid();
    const key = newUlid();
    const fake = recordingWeather(() => Promise.resolve("pending"));

    const first = await saveManualRun(
      coreDb(),
      userId,
      outdoor,
      key,
      fake.weather,
    );
    const second = await saveManualRun(
      coreDb(),
      userId,
      outdoor,
      key,
      fake.weather,
    );

    expect(second.id).toBe(first.id);
  });

  it("with the real attach, the run has its conditions once the work lands", async () => {
    mockVisualCrossing();
    const userId = newUlid();
    const fake = recordingWeather(attachObservation);

    const created = await saveManualRun(
      coreDb(),
      userId,
      outdoor,
      undefined,
      fake.weather,
    );
    await Promise.all(fake.kept);

    expect(await statusOf(created.id)).toBe("attached");
    const summary = await getRunSummary(coreDb(), userId, created.id);
    expect(summary?.conditions?.tempC).toBeTypeOf("number");
    expect(summary?.conditions?.isSetByYou).toBe(false);
    expect(fake.reports).toStrictEqual([]);
  });
});
