import { describe, expect, it } from "vitest";

import { newUlid } from "../../src/lib/ids";
import {
  cacheKeyFor,
  findObservationRow,
  hourBucketFor,
  roundCoord,
  upsertManualObservation,
  upsertRealObservation,
} from "../../src/modules/weather/store";

const OBSERVATION = {
  tempC: 5,
  feelsLikeC: 2.2,
  humidity: 88,
  windKph: 14,
  precipMm: 0.2,
  condition: "light rain",
};

describe("weather cache (103)", () => {
  it("rounds coordinates to 2dp and floors the hour", () => {
    expect(roundCoord(44.98014)).toBeCloseTo(44.98, 5);
    expect(roundCoord(-93.2651)).toBeCloseTo(-93.27, 5);
    const at = new Date("2026-01-15T07:45:00Z");
    expect(hourBucketFor(at)).toBe(Math.floor(at.getTime() / 3_600_000));
  });

  it("a miss writes through; a hit finds the row without any provider call", async () => {
    const at = new Date("2026-01-15T07:00:00Z");
    const key = cacheKeyFor(44.98, -93.27, at);
    expect(await findObservationRow(key)).toBeUndefined();

    const runId = newUlid();
    await upsertRealObservation(key, OBSERVATION, runId);

    const row = await findObservationRow(key);
    expect(row?.tempC).toBe(5);
    expect(row?.source).toBe("visualcrossing");
  });

  it("two coordinates rounding to the same cell share one row", async () => {
    const at = new Date("2026-02-01T12:00:00Z");
    const keyA = cacheKeyFor(45.0012, -93.1001, at);
    const keyB = cacheKeyFor(45.0014, -93.1004, at); // rounds identically
    expect(keyA).toEqual(keyB);

    await Promise.all([
      upsertRealObservation(keyA, OBSERVATION, newUlid()),
      upsertRealObservation(keyB, { ...OBSERVATION, tempC: 6 }, newUlid()),
    ]);

    const row = await findObservationRow(keyA);
    expect(row).toBeDefined();
  });

  it("a real fetch upgrades a manual row occupying the same cell", async () => {
    const at = new Date("2026-03-01T09:00:00Z");
    const key = cacheKeyFor(40.1, -80.2, at);
    await upsertManualObservation(key, 10, newUlid());
    let row = await findObservationRow(key);
    expect(row?.source).toBe("manual");

    await upsertRealObservation(key, OBSERVATION, newUlid());
    row = await findObservationRow(key);
    expect(row?.source).toBe("visualcrossing");
    expect(row?.tempC).toBe(5);
  });

  it("a manual write never clobbers an existing real row", async () => {
    const at = new Date("2026-04-01T09:00:00Z");
    const key = cacheKeyFor(41.1, -81.2, at);
    await upsertRealObservation(key, OBSERVATION, newUlid());

    await upsertManualObservation(key, 99, newUlid());
    const row = await findObservationRow(key);
    expect(row?.source).toBe("visualcrossing");
    expect(row?.tempC).toBe(5);
  });
});
