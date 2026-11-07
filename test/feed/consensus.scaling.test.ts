import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/d1";
import { beforeEach, describe, expect, it } from "vitest";

import { userProfiles } from "../../src/db/schema-core";
import { env } from "../../src/env";
import { feedConditions } from "../../src/modules/feed/compact-conditions";
import {
  consensusAt,
  matchTally,
  yourConditionsConsensus,
} from "../../src/modules/feed/consensus";
import { queryCounts } from "../d1-spy";
import { pointConditions } from "./conditions-fixture";
import {
  makeItem,
  makeObservation,
  makeUser,
  NOW,
  resetTables,
} from "./helpers";
import {
  DAY,
  HOUR,
  FEELS_LIKE_C,
  observationWalk,
  PLACE,
  seedEntry,
  seedObservation,
} from "./scaling-fixture";

/**
 * Design 182: the conditions consensus reads every public entry in its
 * window, so its query count must not grow with the runners in it. Rows
 * read may; the weather side grows only by `observationWalk`'s chunks.
 */

const VIEWER = pointConditions({ tempC: 8, feelsLikeC: FEELS_LIKE_C });

/**
 * Five days back: outside the 3-day window and inside the 14-day one, so
 * one runner and twenty-five take the same path through both windows
 * (an empty first look, then the widening) rather than twenty-five
 * stopping at the first.
 */
const FIVE_DAYS = 5 * DAY;

/**
`count` runners, each with one public dialed entry wearing one top.
*/
async function seedRunners(count: number, ago: number): Promise<void> {
  await seedObservation(ago);
  for (let index = 0; index < count; index += 1) {
    const userId = await makeUser();
    const itemId = await makeItem({ userId });
    await seedEntry({ userId, itemIds: [itemId], ago });
  }
}

/**
 * Counts `read` over a world of one runner and then of twenty-five, the
 * tables reset before each, and `before` run first. Rows read must grow,
 * and each test checks the runners matched, so a seed that never reached
 * the query cannot pass.
 */
async function oneThenTwentyFive<T>(
  read: () => Promise<T>,
  ago: number,
  before?: () => Promise<void>,
) {
  const counted = async (runners: number) => {
    await resetTables();
    await before?.();
    await seedRunners(runners, ago);
    let result: T | undefined;
    const counts = await queryCounts(async () => {
      result = await read();
    });
    return { counts, result };
  };
  const one = await counted(1);
  const twentyFive = await counted(25);
  expect(twentyFive.counts.coreRowsRead).toBeGreaterThan(
    one.counts.coreRowsRead,
  );
  return { one, twentyFive };
}

/**
What one `matchTally` over a window holding `entries` matching ones asks.
*/
function tallyQueries(entries: number) {
  const walk = observationWalk(entries);
  // The window's entries, then `observationsForEntries`'s run chunks,
  // then `wornByRunner`'s two chunked reads (consensus.ts:282): the kit
  // rows of the matching entries and their garments, 80 ids a statement.
  return { core: 1 + walk.core + 2 * walk.core, weather: walk.weather };
}

describe("matchTally: the same queries for 1 runner or 25 (design 182)", () => {
  it("asks core a fixed count, and weather only its chunks", async () => {
    const { one, twentyFive } = await oneThenTwentyFive(
      () => matchTally(VIEWER, NOW - 3 * DAY),
      HOUR,
    );
    expect(one.result?.runners).toBe(1);
    expect(twentyFive.result?.runners).toBe(25);
    expect(twentyFive.counts.core).toBe(one.counts.core);
    expect(one.counts.core).toBe(tallyQueries(1).core);
    expect(twentyFive.counts.weather).toBe(tallyQueries(25).weather);
    expect(one.counts.weather).toBe(tallyQueries(1).weather);
  });
});

/**
 * Both windows over a world whose runners are all five days back: the
 * 3-day look finds nothing (one core read, the walk skipped), then the
 * 14-day one tallies them.
 */
function bothWindows(entries: number) {
  const widened = tallyQueries(entries);
  return { core: 1 + widened.core, weather: widened.weather };
}

describe("yourConditionsConsensus: the same queries for 1 runner or 25", () => {
  it("widens to 14 days at a fixed core count either way", async () => {
    const { one, twentyFive } = await oneThenTwentyFive(
      () => yourConditionsConsensus(VIEWER, NOW),
      FIVE_DAYS,
    );
    expect(one.result).toMatchObject({ status: "too-few", windowDays: 14 });
    expect(twentyFive.result).toMatchObject({
      status: "matched",
      runners: 25,
      windowDays: 14,
    });
    expect(twentyFive.counts.core).toBe(one.counts.core);
    expect(one.counts.core).toBe(bothWindows(1).core);
    expect(one.counts.weather).toBe(bothWindows(1).weather);
    expect(twentyFive.counts.weather).toBe(bothWindows(25).weather);
  });
});

/**
 * The viewer's own reading at `PLACE` now: what `conditionsAt` finds, one
 * weather read (`newestObservationAt`) before the consensus.
 */
async function viewerReading(): Promise<void> {
  await makeObservation({
    ...PLACE,
    startedAt: NOW,
    tempC: 8,
    feelsLikeC: FEELS_LIKE_C,
  });
}

describe("consensusAt: the same queries for 1 runner or 25", () => {
  it("adds the viewer's one reading to both windows", async () => {
    const { one, twentyFive } = await oneThenTwentyFive(
      () => consensusAt(PLACE.lat, PLACE.lng, NOW),
      FIVE_DAYS,
      viewerReading,
    );
    expect(one.result?.status).toBe("too-few");
    expect(twentyFive.result).toMatchObject({ runners: 25 });
    expect(twentyFive.counts.core).toBe(one.counts.core);
    expect(one.counts.core).toBe(bothWindows(1).core);
    expect(one.counts.weather).toBe(1 + bothWindows(1).weather);
    expect(twentyFive.counts.weather).toBe(1 + bothWindows(25).weather);
  });
});

describe("feedConditions: the same queries for 1 runner or 25", () => {
  it("adds the viewer's saved place to consensusAt's count", async () => {
    const viewer = { id: "" };
    const before = async () => {
      await viewerReading();
      viewer.id = await makeUser();
      await drizzle(env.DIALED_CORE)
        .update(userProfiles)
        .set(PLACE)
        .where(eq(userProfiles.userId, viewer.id));
    };
    const { one, twentyFive } = await oneThenTwentyFive(
      () => feedConditions(viewer.id, NOW),
      FIVE_DAYS,
      before,
    );
    expect(one.result?.compact).toBeUndefined();
    expect(twentyFive.result?.compact).toMatchObject({ runners: 25 });
    expect(twentyFive.counts.core).toBe(one.counts.core);
    expect(one.counts.core).toBe(1 + bothWindows(1).core);
    expect(one.counts.weather).toBe(1 + bothWindows(1).weather);
    expect(twentyFive.counts.weather).toBe(1 + bothWindows(25).weather);
  });
});

beforeEach(resetTables);
