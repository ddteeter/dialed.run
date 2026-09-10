import { eq } from "drizzle-orm";
import { describe, expect, it, vi } from "vitest";

import { runs, userProfiles } from "../../src/db/schema-core";
import { newUlid } from "../../src/lib/ids";
import { coreDb } from "../../src/modules/runs/core-db";
import {
  DUPLICATE_WINDOW_S,
  RunNotFoundError,
  runOrNotFound,
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

  it("treats half a coordinate as no location at all", () => {
    // Both halves are required: a latitude with no longitude is not a
    // place, and storing it as one would put the run on the prime meridian.
    expect(initialWeatherStatus({ indoor: false, lat: 44 })).toBe("failed");
    expect(initialWeatherStatus({ indoor: false, lng: -93 })).toBe("failed");
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

  it("accepts a manual temp for a run still waiting on the weather module", async () => {
    // Both unresolved statuses are eligible, not just 'failed': a run whose
    // location is known but whose observation has not landed yet is exactly
    // the case a user types a temperature into.
    const db = coreDb();
    const userId = newUlid();
    const created = await createManualRun(db, userId, {
      startedAt: START + 55_000,
      durationS: 1800,
      distanceM: 5000,
      indoor: false,
      lat: 44.98,
      lng: -93.27,
      title: "Waiting on weather",
    });
    expect(created.weatherStatus).toBe("pending");

    expect(await didRecordManualTemp(db, userId, created.id, 10.5)).toBe(true);
    const run = await getRun(db, userId, created.id);
    expect(run?.weatherStatus).toBe("manual");
  });

  it("logs the temperature it cannot yet store", async () => {
    // Pending(102↔103): until the weather module lands, the temperature is
    // only flipped to 'manual' and the value itself goes nowhere. The log
    // line is what stops it being silently dropped, so it is pinned.
    const db = coreDb();
    const userId = newUlid();
    const created = await createManualRun(db, userId, {
      startedAt: START + 65_000,
      durationS: 1800,
      distanceM: 5000,
      indoor: false,
      title: "Logged",
    });
    // `stubGlobal`, not `spyOn(console, …)`: inside the workers pool the
    // console the test file holds is not the one a src module writes to,
    // so a spy on it records nothing.
    const lines: unknown[][] = [];
    vi.stubGlobal("console", {
      ...globalThis.console,
      info: (...args: unknown[]) => {
        lines.push(args);
      },
    });
    try {
      await didRecordManualTemp(db, userId, created.id, 10.5);
    } finally {
      vi.unstubAllGlobals();
    }

    expect(lines).toStrictEqual([
      ["[manual-temp-pending-weather-module]", { runId: created.id, tempC: 10.5 }],
    ]);
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

describe("createManualRun idempotency", () => {
  const draft = {
    title: "Riverside loop",
    startedAt: Math.floor(Date.now() / 1000) - 3600,
    durationS: 2400,
    distanceM: 7000,
    indoor: true,
  } as const;

  it("returns the same run when the same key is submitted twice", async () => {
    const db = coreDb();
    const userId = newUlid();
    const key = newUlid();

    const first = await createManualRun(db, userId, draft, key);
    const second = await createManualRun(db, userId, draft, key);

    expect(second.id).toBe(first.id);
    const rows = await db
      .select({ id: runs.id })
      .from(runs)
      .where(eq(runs.userId, userId));
    expect(rows).toHaveLength(1);
  });

  it("creates a second run for a different key", async () => {
    const db = coreDb();
    const userId = newUlid();

    const first = await createManualRun(db, userId, draft, newUlid());
    const second = await createManualRun(db, userId, draft, newUlid());

    expect(second.id).not.toBe(first.id);
  });

  it("does not let one user's key collide with another's", async () => {
    const db = coreDb();
    const key = newUlid();
    const userA = newUlid();
    const userB = newUlid();

    const a = await createManualRun(db, userA, draft, key);
    const b = await createManualRun(db, userB, draft, key);

    // Keys are client-generated, so the uniqueness that matters is per
    // user — a shared key must not hand B the run A created.
    expect(b.id).not.toBe(a.id);
  });

  it("still creates a run when no key is supplied", async () => {
    const db = coreDb();
    const userId = newUlid();

    const first = await createManualRun(db, userId, draft);
    const second = await createManualRun(db, userId, draft);

    expect(second.id).not.toBe(first.id);
  });
});
});

describe("what a manual run records", () => {
  it("keeps the effort and the title the runner typed", async () => {
    const db = coreDb();
    const userId = newUlid();
    const { id } = await createManualRun(db, userId, {
      startedAt: START,
      durationS: 1800,
      distanceM: 5000,
      indoor: false,
      lat: 44.98,
      lng: -93.27,
      effort: "workout",
      title: "Tempo intervals",
    });

    const run = await getRun(db, userId, id);
    expect(run).toMatchObject({
      source: "manual",
      startedAt: START,
      durationS: 1800,
      distanceM: 5000,
      effort: "workout",
      title: "Tempo intervals",
    });
  });

  it("drops coordinates on an indoor run, even when they are given", async () => {
    // A treadmill run has no conditions to resolve, and storing the
    // coordinates would make it look like it did.
    const db = coreDb();
    const userId = newUlid();
    const { id, weatherStatus } = await createManualRun(db, userId, {
      startedAt: START + 1,
      durationS: 1800,
      distanceM: 5000,
      indoor: true,
      lat: 44.98,
      lng: -93.27,
      title: "Treadmill",
    });

    const run = await getRun(db, userId, id);
    expect(weatherStatus).toBe("none");
    expect(run?.lat).toBeNull();
    expect(run?.lng).toBeNull();
  });

  it("falls back on the home location only when a coordinate is missing", async () => {
    // Both halves: a run with its own coordinates keeps them, and a run
    // with half of them takes the profile's rather than storing half.
    const db = coreDb();
    const userId = newUlid();
    await db.insert(userProfiles).values({ userId, lat: 10, lng: 20 });

    const own = await createManualRun(db, userId, {
      startedAt: START + 2,
      durationS: 1800,
      distanceM: 5000,
      indoor: false,
      lat: 44.98,
      lng: -93.27,
      title: "Own location",
    });
    const latOnly = await createManualRun(db, userId, {
      startedAt: START + 400,
      durationS: 1800,
      distanceM: 5000,
      indoor: false,
      lat: 44.98,
      title: "Half a location",
    });
    const lngOnly = await createManualRun(db, userId, {
      startedAt: START + 800,
      durationS: 1800,
      distanceM: 5000,
      indoor: false,
      lng: -93.27,
      title: "The other half",
    });

    const ownRun = await getRun(db, userId, own.id);
    expect(ownRun?.lat).toBeCloseTo(44.98, 6);

    // Either half missing sends the whole pair to the profile — the run
    // never ends up with one given coordinate and one inferred.
    for (const created of [latOnly, lngOnly]) {
      const fallbackRun = await getRun(db, userId, created.id);
      expect(fallbackRun?.lat).toBe(10);
      expect(fallbackRun?.lng).toBe(20);
    }
  });
});

describe("findDuplicateRun looks only at the caller's own runs", () => {
  it("never matches another runner's run at the same instant", async () => {
    // Two people starting a run in the same minute is ordinary. Treating
    // it as a duplicate would drop one of their imports.
    const db = coreDb();
    const mine = newUlid();
    const theirs = newUlid();
    await createManualRun(db, theirs, {
      startedAt: START + 900,
      durationS: 1800,
      distanceM: 5000,
      indoor: true,
      title: "Theirs",
    });

    expect(await findDuplicateRun(db, mine, START + 900)).toBeUndefined();
  });
});

describe("listRuns", () => {
  it("answers with nothing for a runner who has logged nothing", async () => {
    expect(await listRuns(coreDb(), newUlid())).toStrictEqual([]);
  });
});

describe("getRun", () => {
  it("refuses to hand over another runner's run", async () => {
    const db = coreDb();
    const owner = newUlid();
    const { id } = await createManualRun(db, owner, {
      startedAt: START + 1200,
      durationS: 1800,
      distanceM: 5000,
      indoor: true,
      title: "Private",
    });

    expect(await getRun(db, newUlid(), id)).toBeUndefined();
    expect(await getRun(db, owner, id)).toBeDefined();
  });

  it("answers with nothing for a run that does not exist", async () => {
    expect(await getRun(coreDb(), newUlid(), newUlid())).toBeUndefined();
  });
});

describe("runOrNotFound", () => {
  /**
   * TanStack's own `notFound()` returns a plain options object rather than
   * an Error, and the house `only-throw-error` rule rejects throwing that.
   * This is the wrapper, and it lives here rather than in the route
   * because a route file cannot be imported by any test.
   */
  it("hands the run back when there is one", () => {
    const run = { id: "01RUN" };
    expect(runOrNotFound(run)).toBe(run);
  });

  it("throws something the router reads as a 404", () => {
    // `isNotFound` is what the router duck-types on. Without it the miss
    // is a 500 — an error screen where a "no such run" belongs.
    let thrown: unknown;
    try {
      runOrNotFound(undefined);
    } catch (error) {
      thrown = error;
    }
    expect(thrown).toBeInstanceOf(RunNotFoundError);
    expect(thrown).toBeInstanceOf(Error);
    expect(thrown).toMatchObject({ isNotFound: true, message: "Run not found." });
  });
});
