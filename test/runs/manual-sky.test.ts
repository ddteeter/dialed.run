import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/d1";
import { describe, expect, it } from "vitest";

import { runs } from "../../src/db/schema-core";
import { manualConditions } from "../../src/db/schema-weather";
import { env } from "../../src/env";
import { newUlid, type Ulid } from "../../src/lib/ids";
import {
  manualReadingsForRuns,
  recordManualObservation,
} from "../../src/modules/weather";
import { upsertManualBand } from "../../src/modules/weather/store";

/**
 * R2b's sky (task 127, STR-12): the pick is stored beside the band, on
 * the run's own `manual_conditions` row, and read back with it — and a
 * band set without one reads back without one.
 */

// Each run gets its own place, so no two land in one weather cache cell
// (the database is shared across a file's tests).
const places = { next: 0 };

async function failedRun(): Promise<Ulid> {
  const id = newUlid();
  places.next += 1;
  await drizzle(env.DIALED_CORE)
    .insert(runs)
    .values({
      id,
      userId: newUlid(),
      source: "file",
      startedAt: 1_700_000_000,
      durationS: 1800,
      distanceM: 5000,
      lat: 10 + places.next,
      lng: 20 + places.next,
      indoor: false,
      title: "Lost weather",
      weatherStatus: "failed",
    });
  return id;
}

async function skyOf(runId: Ulid): Promise<string | null | undefined> {
  const [row] = await drizzle(env.DIALED_WEATHER)
    .select()
    .from(manualConditions)
    .where(eq(manualConditions.runId, runId));
  return row?.sky;
}

describe("the sky a runner picks", () => {
  it("is stored with the band and read back with it", async () => {
    const runId = await failedRun();

    await recordManualObservation(runId, 7.5, "rain");

    expect(await skyOf(runId)).toBe("rain");
    const readings = await manualReadingsForRuns([runId]);
    expect(readings.get(runId)).toMatchObject({
      source: "manual",
      tempC: 7.5,
      sky: "rain",
    });
  });

  it("is absent from a band set without one", async () => {
    const runId = await failedRun();

    await recordManualObservation(runId, 2.5);

    expect(await skyOf(runId)).toBeNull();
    const readings = await manualReadingsForRuns([runId]);
    const reading = readings.get(runId);
    expect(reading).toBeDefined();
    expect(reading).not.toHaveProperty("sky");
  });

  it("is replaced by a later pick, including by none", async () => {
    // The upsert's conflict arm: a retried or repeated save lands the
    // latest pick, and a pick without a sky does not keep a stale one.
    const runId = await failedRun();

    await upsertManualBand(runId, 2.5);
    await upsertManualBand(runId, 2.5, "dry");
    expect(await skyOf(runId)).toBe("dry");

    await upsertManualBand(runId, 7.5);
    expect(await skyOf(runId)).toBeNull();
  });
});
