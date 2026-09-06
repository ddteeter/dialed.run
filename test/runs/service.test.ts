import { describe, expect, it } from "vitest";

import { userProfiles } from "../../src/db/schema-core";
import { newUlid } from "../../src/lib/ids";
import { coreDb } from "../../src/modules/runs/core-db";
import {
  DUPLICATE_WINDOW_S,
  createManualRun,
  didRecordManualTemp,
  findDuplicateRun,
  getRun,
  initialWeatherStatus,
  listRuns,
} from "../../src/modules/runs/service";

const START = 1_755_000_000;

describe("initialWeatherStatus (D-24)", () => {
  it("indoor runs never get conditions", () => {
    expect(initialWeatherStatus({ indoor: true, lat: 44, lng: -93 })).toBe(
      "none",
    );
    expect(initialWeatherStatus({ indoor: true })).toBe("none");
  });

  it("outdoor with a location waits on weather (pending)", () => {
    expect(initialWeatherStatus({ indoor: false, lat: 44, lng: -93 })).toBe(
      "pending",
    );
  });

  it("outdoor with no location is immediately eligible for the manual fallback", () => {
    expect(initialWeatherStatus({ indoor: false })).toBe("failed");
  });
});

describe("createManualRun + findDuplicateRun (102 §1, resilience)", () => {
  it("indoor manual entry gets weather_status 'none' and no coordinates", async () => {
    const db = coreDb();
    const userId = newUlid();
    const created = await createManualRun(db, userId, {
      startedAt: START,
      durationS: 1800,
      distanceM: 5000,
      indoor: true,
      title: "Treadmill",
    });
    expect(created.weatherStatus).toBe("none");
    const run = await getRun(db, userId, created.id);
    expect(run?.lat).toBeNull();
    expect(run?.lng).toBeNull();
  });

  it("outdoor entry without coords falls back to the user's home location", async () => {
    const db = coreDb();
    const userId = newUlid();
    await db.insert(userProfiles).values({ userId, lat: 44.98, lng: -93.27 });

    const created = await createManualRun(db, userId, {
      startedAt: START + 10_000,
      durationS: 1500,
      distanceM: 4000,
      indoor: false,
      title: "Loop",
    });
    expect(created.weatherStatus).toBe("pending");
    const run = await getRun(db, userId, created.id);
    expect(run?.lat).toBeCloseTo(44.98, 2);
    expect(run?.lng).toBeCloseTo(-93.27, 2);
  });

  it("outdoor entry with no coords and no home location is 'failed' (manual-temp eligible)", async () => {
    const db = coreDb();
    const userId = newUlid();
    const created = await createManualRun(db, userId, {
      startedAt: START + 20_000,
      durationS: 1200,
      distanceM: 3000,
      indoor: false,
      title: "Somewhere",
    });
    expect(created.weatherStatus).toBe("failed");
  });

  it("finds a duplicate exactly at the ±120s boundary and rejects just outside it", async () => {
    const db = coreDb();
    const userId = newUlid();
    const startedAt = START + 30_000;
    await createManualRun(db, userId, {
      startedAt,
      durationS: 1800,
      distanceM: 5000,
      indoor: true,
      title: "Original",
    });

    const atBoundary = await findDuplicateRun(
      db,
      userId,
      startedAt + DUPLICATE_WINDOW_S,
    );
    expect(atBoundary).toBeDefined();

    const justOutside = await findDuplicateRun(
      db,
      userId,
      startedAt + DUPLICATE_WINDOW_S + 1,
    );
    expect(justOutside).toBeUndefined();
  });

  it("lists runs newest-first, scoped to the user", async () => {
    const db = coreDb();
    const userId = newUlid();
    await createManualRun(db, userId, {
      startedAt: START + 40_000,
      durationS: 600,
      distanceM: 1000,
      indoor: true,
      title: "First",
    });
    await createManualRun(db, userId, {
      startedAt: START + 41_000,
      durationS: 600,
      distanceM: 1000,
      indoor: true,
      title: "Second",
    });
    const rows = await listRuns(db, userId);
    expect(rows.map((r) => r.title)).toEqual(["Second", "First"]);
  });
});

describe("didRecordManualTemp (D-24 fallback)", () => {
  it("flips weather_status to 'manual' only for unresolved outdoor runs", async () => {
    const db = coreDb();
    const userId = newUlid();
    const created = await createManualRun(db, userId, {
      startedAt: START + 50_000,
      durationS: 1800,
      distanceM: 5000,
      indoor: false,
      title: "Unresolved",
    });
    expect(created.weatherStatus).toBe("failed");

    const didRecord = await didRecordManualTemp(
      db,
      userId,
      created.id,
      10.5,
    );
    expect(didRecord).toBe(true);
    const run = await getRun(db, userId, created.id);
    expect(run?.weatherStatus).toBe("manual");
  });

  it("is a no-op for indoor runs (never eligible)", async () => {
    const db = coreDb();
    const userId = newUlid();
    const created = await createManualRun(db, userId, {
      startedAt: START + 60_000,
      durationS: 1800,
      distanceM: 5000,
      indoor: true,
      title: "Treadmill",
    });
    const didRecord = await didRecordManualTemp(db, userId, created.id, 10);
    expect(didRecord).toBe(false);
  });

  it("is a no-op once an observation already attached", async () => {
    const db = coreDb();
    const userId = newUlid();
    const created = await createManualRun(db, userId, {
      startedAt: START + 70_000,
      durationS: 1800,
      distanceM: 5000,
      indoor: false,
      title: "Attached",
    });
    // Simulate the weather module having already attached an observation.
    await didRecordManualTemp(db, userId, created.id, 10);
    const didRecordSecondTime = await didRecordManualTemp(
      db,
      userId,
      created.id,
      12,
    );
    expect(didRecordSecondTime).toBe(false);
  });
});
