import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { z } from "zod";

import { outfitEntries, runs, userProfiles } from "../../src/db/schema-core";
import { newUlid } from "../../src/lib/ids";
import type { Ulid } from "../../src/lib/ids";
import { coreDb } from "../../src/modules/runs/core-db";
import {
  DUPLICATE_WINDOW_S,
  createManualRun,
  didRetimeRun,
  didRetryRunWeather,
  didSetRunConditions,
  findDuplicateRun,
  getRun,
  getRunSummary,
  initialWeatherStatus,
  listRunSummaries,
} from "../../src/modules/runs/service";
import { recordManualObservation } from "../../src/modules/weather";
import { makeObservation } from "../feed/helpers";

import { nowSeconds } from "../../src/lib/now";
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
    const rows = await listRunSummaries(db, userId);
    expect(rows.map((r) => r.startedAt)).toEqual([
      START + 41_000,
      START + 40_000,
    ]);
  });
});

describe("createManualRun, again", () => {
  describe("createManualRun idempotency", () => {
    const draft = {
      title: "Riverside loop",
      startedAt: nowSeconds() - 3600,
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

describe("listRunSummaries", () => {
  it("answers with nothing for a runner who has logged nothing", async () => {
    expect(await listRunSummaries(coreDb(), newUlid())).toStrictEqual([]);
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

const LAT = 44.98;
const LNG = -93.27;

/**
SQL NULL, as a run with no position holds it.
*/
const NOWHERE = z.null().parse(JSON.parse("null"));

/**
 * A run inserted as it stands in the table, so each test can put it in the
 * weather state it is about.
 */
async function aRun(
  userId: string,
  overrides: Partial<typeof runs.$inferInsert> = {},
): Promise<string> {
  const id = newUlid();
  await coreDb()
    .insert(runs)
    .values({
      id,
      userId,
      source: "file",
      startedAt: START,
      durationS: 3098,
      distanceM: 9978,
      title: "Morning run",
      lat: LAT,
      lng: LNG,
      weatherStatus: "failed",
      ...overrides,
    });
  return id;
}

async function statusOf(runId: string) {
  const run = await getRun(coreDb(), (await ownerOf(runId)) ?? "", runId);
  return run?.weatherStatus;
}

async function ownerOf(runId: string): Promise<string | undefined> {
  const [row] = await coreDb()
    .select({ userId: runs.userId })
    .from(runs)
    .where(eq(runs.id, runId));
  return row?.userId;
}

/**
The weather module's writes, recorded rather than performed.
*/
function fakeWeather() {
  const attached: Ulid[] = [];
  const recorded: { runId: Ulid; tempC: number }[] = [];
  return {
    attached,
    recorded,
    attach: (runId: Ulid) => {
      attached.push(runId);
      return Promise.resolve();
    },
    record: (runId: Ulid, tempC: number) => {
      recorded.push({ runId, tempC });
      return Promise.resolve();
    },
  };
}

describe("getRunSummary / listRunSummaries: a run as the screens draw it", () => {
  it("carries the conditions the weather sent, and says they were not set by hand", async () => {
    const userId = newUlid();
    const runId = await aRun(userId, { weatherStatus: "attached" });
    await makeObservation({
      lat: LAT,
      lng: LNG,
      startedAt: START,
      tempC: 5,
      feelsLikeC: 2,
      precipMm: 1,
      timeZone: "America/Chicago",
    });

    const summary = await getRunSummary(coreDb(), userId, runId);

    expect(summary).toStrictEqual({
      id: runId,
      source: "file",
      startedAt: START,
      durationS: 3098,
      distanceM: 9978,
      indoor: false,
      weatherStatus: "attached",
      canSetConditions: false,
      conditions: {
        tempC: 5,
        feelsLikeC: 2,
        humidity: 50,
        windKph: 10,
        precipMm: 1,
        condition: "clear",
        timeZone: "America/Chicago",
        isSetByYou: false,
      },
      entryId: undefined,
      hasVerdict: false,
    });
    const [listed] = await listRunSummaries(coreDb(), userId);
    expect(listed).toStrictEqual(summary);
  });

  it("marks a band chosen in R2b as set by you, in the list as on the run", async () => {
    const userId = newUlid();
    const runId = await aRun(userId, { startedAt: START + 7200 });
    await recordManualObservation(runId as Ulid, 12.5);

    const [listed] = await listRunSummaries(coreDb(), userId);
    expect(listed?.weatherStatus).toBe("manual");
    expect(listed?.conditions?.tempC).toBe(12.5);
    expect(listed?.conditions?.isSetByYou).toBe(true);
    const summary = await getRunSummary(coreDb(), userId, runId);
    expect(summary?.conditions?.isSetByYou).toBe(true);
  });

  it("carries the entry, and whether it has a verdict, so the row opens the right door", async () => {
    const userId = newUlid();
    const judged = await aRun(userId, { startedAt: START + 100 });
    const kitted = await aRun(userId, { startedAt: START + 200 });
    const bare = await aRun(userId, { startedAt: START + 300 });
    const judgedEntry = newUlid();
    const kittedEntry = newUlid();
    await coreDb()
      .insert(outfitEntries)
      .values([
        {
          id: judgedEntry,
          userId,
          runId: judged,
          verdict: 0,
          isPublic: true,
          createdAt: START,
        },
        {
          id: kittedEntry,
          userId,
          runId: kitted,
          isPublic: true,
          createdAt: START,
        },
      ]);

    const listed = await listRunSummaries(coreDb(), userId);

    expect(
      listed.map((run) => [run.id, run.entryId, run.hasVerdict]),
    ).toStrictEqual([
      [bare, undefined, false],
      [kitted, kittedEntry, false],
      [judged, judgedEntry, true],
    ]);
  });

  it("says R2b may be offered only for a located run the weather gave up on", async () => {
    const userId = newUlid();
    const failed = await aRun(userId, { startedAt: START + 10 });
    const nowhere = await aRun(userId, {
      startedAt: START + 20,
      lat: NOWHERE,
      lng: NOWHERE,
    });
    const pending = await aRun(userId, {
      startedAt: START + 30,
      weatherStatus: "pending",
    });

    const listed = await listRunSummaries(coreDb(), userId);
    const byId = new Map(listed.map((run) => [run.id, run]));

    expect(byId.get(failed)?.canSetConditions).toBe(true);
    expect(byId.get(nowhere)?.canSetConditions).toBe(false);
    expect(byId.get(pending)?.canSetConditions).toBe(false);
  });

  it("lists only the runner's own runs, and at most fifty, newest first", async () => {
    const userId = newUlid();
    for (let index = 0; index < 51; index += 1) {
      await aRun(userId, { startedAt: START + index, weatherStatus: "none" });
    }
    await aRun(newUlid());

    const listed = await listRunSummaries(coreDb(), userId);

    expect(listed).toHaveLength(50);
    expect(listed[0]?.startedAt).toBe(START + 50);
    expect(listed.at(-1)?.startedAt).toBe(START + 1);
  });

  it("answers nothing for another runner's run", async () => {
    const runId = await aRun(newUlid());
    expect(await getRunSummary(coreDb(), newUlid(), runId)).toBeUndefined();
  });
});

describe("didSetRunConditions: R2b's pick", () => {
  it("stores the band's middle for a run the weather gave up on", async () => {
    const userId = newUlid();
    const runId = await aRun(userId);
    const weather = fakeWeather();

    expect(
      await didSetRunConditions(coreDb(), weather, userId, runId, 10),
    ).toBe(true);
    expect(weather.recorded).toStrictEqual([{ runId, tempC: 12.5 }]);
  });

  it("refuses a run whose weather arrived, one with no place, and someone else's", async () => {
    const userId = newUlid();
    const weather = fakeWeather();
    const attached = await aRun(userId, { weatherStatus: "attached" });
    const nowhere = await aRun(userId, { lat: NOWHERE, lng: NOWHERE });
    const theirs = await aRun(newUlid());

    for (const runId of [attached, nowhere, theirs]) {
      expect(
        await didSetRunConditions(coreDb(), weather, userId, runId, 10),
      ).toBe(false);
    }
    expect(weather.recorded).toHaveLength(0);
  });
});

describe("didRetryRunWeather: R2b's Try again", () => {
  it("puts the run back to pending, then asks once", async () => {
    const userId = newUlid();
    const runId = await aRun(userId);
    const statusWhenAsked: (string | undefined)[] = [];
    const weather = {
      attach: async (asked: Ulid) => {
        statusWhenAsked.push(await statusOf(asked));
      },
    };

    expect(await didRetryRunWeather(coreDb(), weather, userId, runId)).toBe(
      true,
    );
    // Pending before the attempt: that is the marker the hourly cron
    // re-drives if this one comes to nothing.
    expect(statusWhenAsked).toStrictEqual(["pending"]);
    expect(await statusOf(runId)).toBe("pending");
  });

  it("refuses a run R2b may not be offered for, and changes nothing", async () => {
    const userId = newUlid();
    const weather = fakeWeather();
    const attached = await aRun(userId, { weatherStatus: "attached" });
    const theirs = await aRun(newUlid());

    expect(await didRetryRunWeather(coreDb(), weather, userId, attached)).toBe(
      false,
    );
    expect(await didRetryRunWeather(coreDb(), weather, userId, theirs)).toBe(
      false,
    );
    expect(weather.attached).toHaveLength(0);
    expect(await statusOf(attached)).toBe("attached");
  });
});

describe("didRetimeRun: A1's time correction", () => {
  it("moves the start and asks for the weather at the new hour", async () => {
    const userId = newUlid();
    const runId = await aRun(userId, { weatherStatus: "attached" });
    const weather = fakeWeather();

    expect(await didRetimeRun(coreDb(), weather, userId, runId, -5400)).toBe(
      true,
    );

    const run = await getRun(coreDb(), userId, runId);
    expect(run?.startedAt).toBe(START - 5400);
    expect(run?.weatherStatus).toBe("pending");
    expect(weather.attached).toStrictEqual([runId]);
  });

  it("moves the start of a run with no place, and asks for no weather", async () => {
    const userId = newUlid();
    const runId = await aRun(userId, {
      lat: NOWHERE,
      lng: NOWHERE,
      weatherStatus: "failed",
    });
    const weather = fakeWeather();

    expect(await didRetimeRun(coreDb(), weather, userId, runId, 600)).toBe(
      true,
    );

    const run = await getRun(coreDb(), userId, runId);
    expect(run?.startedAt).toBe(START + 600);
    expect(run?.weatherStatus).toBe("failed");
    expect(weather.attached).toHaveLength(0);
  });

  it("needs both halves of a position to ask again", async () => {
    const userId = newUlid();
    const halfway = await aRun(userId, {
      lng: NOWHERE,
      weatherStatus: "failed",
    });
    const weather = fakeWeather();

    await didRetimeRun(coreDb(), weather, userId, halfway, 60);

    expect(weather.attached).toHaveLength(0);
    expect(await statusOf(halfway)).toBe("failed");
  });

  it("will not move someone else's run", async () => {
    const owner = newUlid();
    const runId = await aRun(owner);
    const weather = fakeWeather();

    expect(await didRetimeRun(coreDb(), weather, newUlid(), runId, 600)).toBe(
      false,
    );
    const run = await getRun(coreDb(), owner, runId);
    expect(run?.startedAt).toBe(START);
  });
});
