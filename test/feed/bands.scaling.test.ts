import { drizzle } from "drizzle-orm/d1";
import { beforeEach, describe, expect, it } from "vitest";

import { env } from "../../src/env";
import {
  attachContext,
  prefillForRun,
} from "../../src/modules/feed/attach-context";
import {
  bandRunsInput,
  recentRunsInBand,
} from "../../src/modules/feed/band-runs";
import { bandSignalsForEntry } from "../../src/modules/feed/band-signals";
import {
  itemBandWearStat,
  verdictBandCounts,
} from "../../src/modules/feed/entries";
import { garmentBandCountOrNone } from "../../src/modules/feed/garment-bands";
import { coverageLadder } from "../../src/modules/feed/ladder-read";
import { queryCounts } from "../d1-spy";
import type { QueryCounts } from "../d1-spy";
import { makeItem, makeRun, makeUser, NOW, resetTables } from "./helpers";
import {
  BAND_FLOOR_C,
  HOUR,
  observationWalk,
  PLACE,
  seedEntry,
  seedObservation,
} from "./scaling-fixture";

/**
 * Design 182: a runner's own band reads walk their last entries, so their
 * query counts must not grow with how many entries there are. Rows read
 * may; the weather side grows only by `observationWalk`'s chunks.
 */

interface World {
  userId: string;
  itemId: string;
  /**
  A run of this runner's with no entry yet, at `PLACE`, in the same hour.
  */
  runId: string;
}

/**
 * One runner, one garment worn on each of `count` dialed entries in
 * `BAND_FLOOR_C`'s band, plus one more entry (the one a read judges) and
 * one run with no entry: the ones a read leaves out of its own history.
 */
async function seedWorld(count: number): Promise<World> {
  await resetTables();
  await seedObservation();
  const userId = await makeUser();
  const itemId = await makeItem({ userId });
  for (let index = 0; index < count; index += 1) {
    await seedEntry({ userId, itemIds: [itemId] });
  }
  return { userId, itemId, runId: await runWithNoEntry(userId) };
}

/**
A run of the runner's at `PLACE`, in the seeded hour, with no entry yet.
*/
function runWithNoEntry(userId: string): Promise<string> {
  return makeRun({ userId, ...PLACE, startedAt: NOW - HOUR, durationS: 60 });
}

/**
 * `seedWorld`, plus the entry a read judges: one more of the runner's,
 * kept out of its own record, so the counted entries are the others.
 */
async function withJudged(count: number) {
  const world = await seedWorld(count);
  const entryId = await seedEntry({
    userId: world.userId,
    itemIds: [world.itemId],
  });
  return { ...world, entryId };
}

/**
 * One runner with `count` garments and a run to dress: what grows here is
 * the closet, not the history.
 */
async function closet(count: number): Promise<World> {
  await resetTables();
  await seedObservation();
  const userId = await makeUser();
  for (let index = 0; index < count; index += 1) {
    await makeItem({ userId, name: `Top ${String(index)}` });
  }
  return { userId, itemId: "", runId: await runWithNoEntry(userId) };
}

/**
 * Counts `read` over a world of 1 entry and then of 25, and checks the
 * seed reached the query: rows read grew.
 */
async function oneThenTwentyFive<T, W extends World = World>(
  read: (world: W) => Promise<T>,
  seed: (count: number) => Promise<W>,
): Promise<{
  one: { counts: QueryCounts; result: T | undefined };
  twentyFive: { counts: QueryCounts; result: T | undefined };
}> {
  const counted = async (count: number) => {
    const world = await seed(count);
    let result: T | undefined;
    const counts = await queryCounts(async () => {
      result = await read(world);
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
Core flat; weather exactly the walk over `entries` plus `extraWeather`.
*/
function expectFlat(
  one: QueryCounts,
  twentyFive: QueryCounts,
  core: number,
  extraWeather = 0,
): void {
  expect(twentyFive.core).toBe(one.core);
  expect(one.core).toBe(core);
  expect(one.weather).toBe(extraWeather + observationWalk(1).weather);
  expect(twentyFive.weather).toBe(extraWeather + observationWalk(25).weather);
}

beforeEach(resetTables);

describe("verdictedEntriesInBand's readers (entries.ts:402)", () => {
  // The base walk: the runner's last 200 verdicted entries, then
  // `observationsForEntries`' run chunk.
  const walk = 1 + observationWalk(1).core;

  it("verdictBandCounts: the same queries for 1 entry or 25", async () => {
    const { one, twentyFive } = await oneThenTwentyFive(
      (world) => verdictBandCounts(world.userId, BAND_FLOOR_C),
      seedWorld,
    );
    expect(one.result?.[0]).toBe(1);
    expect(twentyFive.result?.[0]).toBe(25);
    expectFlat(one.counts, twentyFive.counts, walk);
  });

  it("itemBandWearStat: the same queries for 1 entry or 25", async () => {
    const { one, twentyFive } = await oneThenTwentyFive(
      (world) => itemBandWearStat(world.userId, world.itemId, BAND_FLOOR_C),
      seedWorld,
    );
    expect(one.result).toStrictEqual({ worn: 1, total: 1 });
    expect(twentyFive.result).toStrictEqual({ worn: 25, total: 25 });
    // The walk, then the band's entries wearing the item, 80 a statement.
    expectFlat(one.counts, twentyFive.counts, walk + observationWalk(1).core);
  });

  it("recentRunsInBand: the same queries for 1 entry or 25", async () => {
    const { one, twentyFive } = await oneThenTwentyFive(
      (world) =>
        recentRunsInBand(
          world.userId,
          bandRunsInput.parse({ bandFloorC: BAND_FLOOR_C }).bandFloorC,
        ),
      seedWorld,
    );
    expect(one.result).toHaveLength(1);
    // BAND_RUNS_SHOWN: the rail shows three, read in one statement.
    expect(twentyFive.result).toHaveLength(3);
    expect(twentyFive.result?.[0]?.pieces).toHaveLength(1);
    expectFlat(one.counts, twentyFive.counts, walk + 1);
  });

  it("bandSignalsForEntry: the same queries for 1 entry or 25", async () => {
    const { one, twentyFive } = await oneThenTwentyFive(
      (world) => bandSignalsForEntry(world.userId, world.entryId, BAND_FLOOR_C),
      withJudged,
    );
    expect(Object.values(one.result?.garments ?? {})).toStrictEqual([
      { total: 1, dialed: 1, colder: 0, warmer: 0 },
    ]);
    expect(Object.values(twentyFive.result?.garments ?? {})).toStrictEqual([
      { total: 25, dialed: 25, colder: 0, warmer: 0 },
    ]);
    // The kit, the walk, then one batch of two (kit rows and tags) per 80
    // in-band entries (band-signals.ts:102): two statements either way.
    expectFlat(
      one.counts,
      twentyFive.counts,
      1 + walk + 2 * observationWalk(1).core,
    );
  });
});

describe("coverageLadder (ladder-read.ts:18)", () => {
  it("asks the same queries for 1 entry or 25", async () => {
    const { one, twentyFive } = await oneThenTwentyFive(
      (world) => coverageLadder(world.userId),
      seedWorld,
    );
    expect(one.result).toMatchObject([{ bandFloorC: BAND_FLOOR_C, dialed: 1 }]);
    expect(twentyFive.result).toMatchObject([
      { bandFloorC: BAND_FLOOR_C, dialed: 25 },
    ]);
    // The last 200 entries, the walk's run chunk, the runner's units.
    expectFlat(one.counts, twentyFive.counts, 1 + observationWalk(1).core + 1);
  });
});

/**
 * `ownRun`, then `observationsForRuns([run])` for its conditions: one
 * cache-cell read and one band read on weather (attach-context.ts:52).
 */
const OWN_RUN = { core: 1, weather: 2 };

describe("prefillForRun → nearestPriorEntry (prefill.ts:94)", () => {
  it("asks the same queries for 1 past entry or 25", async () => {
    const { one, twentyFive } = await oneThenTwentyFive(
      (world) => prefillForRun(world.userId, world.runId),
      seedWorld,
    );
    expect(one.result?.itemIds).toHaveLength(1);
    expect(twentyFive.result?.itemIds).toHaveLength(1);
    // The run, the history, its run chunk, then the best entry's kit.
    expectFlat(
      one.counts,
      twentyFive.counts,
      OWN_RUN.core + 1 + observationWalk(1).core + 1,
      OWN_RUN.weather,
    );
  });
});

describe("attachContext → pickerGroups (picker.ts:34)", () => {
  it("asks the same queries for 1 garment or 25", async () => {
    const { one, twentyFive } = await oneThenTwentyFive(
      (world) => attachContext(world.userId, world.runId),
      closet,
    );
    const itemsIn = (result: typeof one.result) =>
      (result?.groups ?? []).flatMap((group) => group.items).length;
    expect(itemsIn(one.result)).toBe(1);
    expect(itemsIn(twentyFive.result)).toBe(25);
    expect(twentyFive.counts).toMatchObject({
      core: one.counts.core,
      weather: one.counts.weather,
    });
    expect(one.counts).toMatchObject({
      core: OWN_RUN.core + 1,
      weather: OWN_RUN.weather,
    });
  });
});

describe("garmentBandCountOrNone (garment-bands.ts:43)", () => {
  it("asks the same queries for 1 entry wearing the piece or 25", async () => {
    const { one, twentyFive } = await oneThenTwentyFive(
      (world) =>
        garmentBandCountOrNone(
          drizzle(env.DIALED_CORE),
          world.userId,
          world.itemId,
        ),
      seedWorld,
    );
    expect(one.result).toBe(1);
    expect(twentyFive.result).toBe(1);
    // The piece's verdicted entries, then the walk's run chunk.
    expectFlat(one.counts, twentyFive.counts, 1 + observationWalk(1).core);
  });
});
