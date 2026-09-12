import { beforeEach, describe, expect, it } from "vitest";
import { z } from "zod";
import { drizzle } from "drizzle-orm/d1";

import { follows as followsTable, userProfiles as userProfilesTable } from "../../src/db/schema-core";
import { env } from "../../src/env";
import { newUlid } from "../../src/lib/ids";
import {
  conditionsAt,
  currentConditions,
  observationsForEntries,
  observationsForRuns,
} from "../../src/modules/feed/conditions";
import { follow, followerCount } from "../../src/modules/feed/follows";
import { searchByDisplayName } from "../../src/modules/feed/search";
import { pointConditions } from "../feed/conditions-fixture";
import {
  makeEntry,
  makeObservation,
  makeRun,
  makeUser,
  resetTables,
  NOW,
} from "./helpers";

/**
 * The entry → run → observation walk, which exists because `DIALED_CORE`
 * and `DIALED_WEATHER` are separate databases and D1 cannot join them
 * (law 8c). Three call sites had it copy-pasted before it was one function,
 * and none of them tested the parts that are easy to get wrong: a run with
 * no coordinates, more runs than fit in one `IN` list, and a row that comes
 * back from the same query but belongs to a different cell.
 */

const HOUR = 3600;

/**
An unset coordinate column, parsed rather than written as a literal.
*/
function coordinateNull(): number | null {
  return z.null().parse(JSON.parse("null"));
}

function coreDb() {
  return drizzle(env.DIALED_CORE);
}

beforeEach(async () => {
  await resetTables();
});

describe("observationsForRuns", () => {
  it("answers with nothing for no runs", async () => {
    const observations = await observationsForRuns([]);
    expect(observations.size).toBe(0);
  });

  it("resolves each run to the observation at its own cell", async () => {
    const userId = await makeUser();
    const first = await makeRun({ userId, lat: 41.11, lng: -93.27 });
    const second = await makeRun({ userId, lat: 42.22, lng: -93.27 });
    await makeObservation({
      lat: 41.11,
      lng: -93.27,
      startedAt: NOW,
      tempC: 1,
      feelsLikeC: -1,
    });
    await makeObservation({
      lat: 42.22,
      lng: -93.27,
      startedAt: NOW,
      tempC: 20,
      feelsLikeC: 21,
    });

    const observations = await observationsForRuns([
      { id: first, lat: 41.11, lng: -93.27, startedAt: NOW, durationS: 0 },
      { id: second, lat: 42.22, lng: -93.27, startedAt: NOW, durationS: 0 },
    ]);

    expect(observations.get(first)?.tempC).toBe(1);
    expect(observations.get(second)?.tempC).toBe(20);
  });

  it("drops a run missing either coordinate rather than keying it to zero", async () => {
    // `cacheKeyFor` rounds, so a null coordinate keys to 0 — a run with no
    // location would be handed the weather at Null Island.
    await makeObservation({
      lat: 0,
      lng: 0,
      startedAt: NOW,
      tempC: 30,
      feelsLikeC: 33,
    });
    await makeObservation({
      lat: 43.33,
      lng: 0,
      startedAt: NOW,
      tempC: 30,
      feelsLikeC: 33,
    });
    await makeObservation({
      lat: 0,
      lng: -73.33,
      startedAt: NOW,
      tempC: 30,
      feelsLikeC: 33,
    });

    const missing = coordinateNull();
    const observations = await observationsForRuns([
      { id: "no-lat", lat: missing, lng: -73.33, startedAt: NOW, durationS: 0 },
      { id: "no-lng", lat: 43.33, lng: missing, startedAt: NOW, durationS: 0 },
      { id: "neither", lat: missing, lng: missing, startedAt: NOW, durationS: 0 },
    ]);

    expect(observations.size).toBe(0);
  });

  it("resolves more runs than fit in one query", async () => {
    // The reads are chunked. A chunk loop that stops early, or slices the
    // whole list every time, silently answers about the first twenty runs.
    const userId = await makeUser();
    const runIds: string[] = [];
    for (let index = 0; index < 25; index += 1) {
      const lat = 44 + index / 100;
      runIds.push(await makeRun({ userId, lat, lng: -93.27 }));
      await makeObservation({
        lat,
        lng: -93.27,
        startedAt: NOW,
        tempC: index,
        feelsLikeC: index,
      });
    }

    const observations = await observationsForRuns(
      runIds.map((id, index) => ({
        id,
        durationS: 0,
        lat: 44 + index / 100,
        lng: -93.27,
        startedAt: NOW,
      })),
    );

    expect(observations.size).toBe(25);
    expect(observations.get(runIds[24] ?? "")?.tempC).toBe(24);
  });

  it("never gives a run the observation from a neighbouring place", async () => {
    // Same hour, different longitude. One query fetches both rows, so all
    // three key parts have to match or the nearer run takes whichever came
    // back first.
    const userId = await makeUser();
    const here = await makeRun({ userId, lat: 53.11, lng: -93.27 });
    const there = await makeRun({ userId, lat: 53.11, lng: -80.27 });
    await makeObservation({
      lat: 53.11,
      lng: -93.27,
      startedAt: NOW,
      tempC: 2,
      feelsLikeC: 0,
    });
    await makeObservation({
      lat: 53.11,
      lng: -80.27,
      startedAt: NOW,
      tempC: 22,
      feelsLikeC: 20,
    });

    const observations = await observationsForRuns([
      { id: here, lat: 53.11, lng: -93.27, startedAt: NOW, durationS: 0 },
      { id: there, lat: 53.11, lng: -80.27, startedAt: NOW, durationS: 0 },
    ]);

    expect(observations.get(here)?.tempC).toBe(2);
    expect(observations.get(there)?.tempC).toBe(22);
  });

  it("never gives a run an observation from a neighbouring cell", async () => {
    // One query fetches the whole chunk, so every row of it comes back for
    // every run in it. Matching on all three key parts is what keeps them
    // apart — two runs an hour apart at the same place would otherwise
    // share whichever row was found first.
    const userId = await makeUser();
    const early = await makeRun({ userId, lat: 46.11, lng: -93.27 });
    const late = await makeRun({
      userId,
      lat: 46.11,
      lng: -93.27,
      startedAt: NOW + HOUR,
    });
    await makeObservation({
      lat: 46.11,
      lng: -93.27,
      startedAt: NOW,
      tempC: 2,
      feelsLikeC: 0,
    });

    const observations = await observationsForRuns([
      { id: early, lat: 46.11, lng: -93.27, startedAt: NOW, durationS: 0 },
      { id: late, lat: 46.11, lng: -93.27, startedAt: NOW + HOUR, durationS: 0 },
    ]);

    expect(observations.get(early)?.tempC).toBe(2);
    expect(observations.has(late)).toBe(false);
  });
});

describe("observationsForEntries", () => {
  it("asks nothing for no entries", async () => {
    const observations = await observationsForEntries(coreDb(), []);
    expect(observations.size).toBe(0);
  });

  it("walks entry to run to observation", async () => {
    const userId = await makeUser();
    const runId = await makeRun({ userId, lat: 47.11, lng: -93.27 });
    await makeObservation({
      lat: 47.11,
      lng: -93.27,
      startedAt: NOW,
      tempC: 7,
      feelsLikeC: 5,
    });
    await makeEntry({ userId, runId });

    const observations = await observationsForEntries(coreDb(), [{ runId }]);

    expect(observations.get(runId)?.feelsLikeC).toBe(5);
  });
});

describe("currentConditions", () => {
  it("answers with nothing when nothing has been observed nearby", async () => {
    expect(await currentConditions(48.11, -93.27, NOW)).toBeUndefined();
  });

  it("takes the most recent observation within the fresh window", async () => {
    // Looking backwards, not forwards: an observation an hour old is the
    // best available answer, and one from the future does not exist.
    await makeObservation({
      lat: 49.11,
      lng: -93.27,
      startedAt: NOW - HOUR,
      tempC: 3,
      feelsLikeC: 1,
    });
    await makeObservation({
      lat: 49.11,
      lng: -93.27,
      startedAt: NOW,
      tempC: 6,
      feelsLikeC: 4,
    });

    const conditions = await currentConditions(49.11, -93.27, NOW);

    expect(conditions?.tempC).toBe(6);
  });

  it("looks backwards from now, not forwards", async () => {
    // The only observation is an hour old, which is exactly what the fresh
    // window is for. Counting hours the other way makes it invisible.
    await makeObservation({
      lat: 54.11,
      lng: -93.27,
      startedAt: NOW - HOUR,
      tempC: 8,
      feelsLikeC: 6,
    });

    const conditions = await currentConditions(54.11, -93.27, NOW);

    expect(conditions?.tempC).toBe(8);
  });

  it("ignores a temperature a human typed", async () => {
    // Manual rows are excluded from anything aggregated or offered as
    // current — the call is built on resolved observations.
    await makeObservation({
      lat: 50.11,
      lng: -93.27,
      startedAt: NOW,
      tempC: 99,
      feelsLikeC: 99,
      source: "manual",
    });

    expect(await currentConditions(50.11, -93.27, NOW)).toBeUndefined();
  });

  it("ignores an observation older than the fresh window", async () => {
    await makeObservation({
      lat: 51.11,
      lng: -93.27,
      startedAt: NOW - 24 * HOUR,
      tempC: 3,
      feelsLikeC: 1,
    });

    expect(await currentConditions(51.11, -93.27, NOW)).toBeUndefined();
  });

  it("carries every field the card shows", async () => {
    await makeObservation({
      lat: 52.11,
      lng: -93.27,
      startedAt: NOW,
      tempC: 6,
      feelsLikeC: 4,
      precipMm: 2,
    });

    expect(await currentConditions(52.11, -93.27, NOW)).toStrictEqual(pointConditions({ tempC: 6, feelsLikeC: 4, precipMm: 2, windKph: 10 }));
  });
});

describe("searchByDisplayName", () => {
  it("answers with nothing for a blank query", async () => {
    // Including one that is only spaces: an untrimmed blank becomes
    // `LIKE ' %'`, which is a full scan for nothing.
    await makeUser({ displayName: "Somebody" });
    expect(await searchByDisplayName("")).toStrictEqual([]);
    expect(await searchByDisplayName(" ".repeat(3))).toStrictEqual([]);
  });

  it("matches on a trimmed prefix", async () => {
    const userId = await makeUser({ displayName: "Tracksmith Runner" });

    const results = await searchByDisplayName("  Tracksmith ".trimEnd());

    expect(results).toStrictEqual([
      { userId, displayName: "Tracksmith Runner" },
    ]);
  });

  it("matches a prefix, not a substring", async () => {
    await makeUser({ displayName: "Fast Runner" });
    expect(await searchByDisplayName("Runner")).toStrictEqual([]);
  });

  it("leaves out a profile that has no display name", async () => {
    // The result type promises a name. A row with none is not a person you
    // can offer to follow.
    const userId = newUlid();
    await coreDb()
      .insert(userProfilesTable)
      .values({ userId, shareDefault: true });

    expect(await searchByDisplayName("")).toStrictEqual([]);
  });
});

describe("follow", () => {
  it("silently ignores an attempt to follow yourself", async () => {
    // Not an error — the button is simply never offered, and a crafted
    // request must not make a runner their own follower.
    const userId = await makeUser();

    await follow(userId, userId);

    expect(await followerCount(userId)).toBe(0);
  });

  it("stamps the follow in epoch seconds", async () => {
    const follower = await makeUser();
    const followee = await makeUser();
    const before = Math.floor(Date.now() / 1000);

    await follow(follower, followee);

    const [row] = await coreDb().select().from(followsTable);
    expect(row?.createdAt).toBeGreaterThanOrEqual(before - 5);
    expect(row?.createdAt).toBeLessThanOrEqual(before + 5);
  });
});

describe("conditionsAt", () => {
  it("asks for nothing when either coordinate is missing", async () => {
    // A browser can refuse geolocation, and the picker still has to show
    // the closet. The planted observations are what make the refusal
    // visible: `cacheKeyFor` rounds, so a missing coordinate keys to 0 —
    // half a location would silently be answered with the weather at that
    // half-key rather than with "unknown".
    await makeObservation({
      lat: 0,
      lng: -93.27,
      startedAt: NOW,
      tempC: 30,
      feelsLikeC: 33,
    });
    await makeObservation({
      lat: 55.11,
      lng: 0,
      startedAt: NOW,
      tempC: 30,
      feelsLikeC: 33,
    });
    await makeObservation({
      lat: 0,
      lng: 0,
      startedAt: NOW,
      tempC: 30,
      feelsLikeC: 33,
    });

    expect(await conditionsAt(undefined, -93.27, NOW)).toBeUndefined();
    expect(await conditionsAt(55.11, undefined, NOW)).toBeUndefined();
    expect(await conditionsAt(undefined, undefined, NOW)).toBeUndefined();
  });

  it("resolves the conditions when both are known", async () => {
    await makeObservation({
      lat: 56.11,
      lng: -93.27,
      startedAt: NOW,
      tempC: 4,
      feelsLikeC: 2,
    });

    const conditions = await conditionsAt(56.11, -93.27, NOW);
    expect(conditions?.tempC).toBe(4);
  });
});
