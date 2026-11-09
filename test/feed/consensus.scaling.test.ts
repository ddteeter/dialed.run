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
import { IN_LIST_CHUNK } from "../../src/lib/chunked";
import { queryCounts } from "../d1-spy";
import { pointConditions } from "./conditions-fixture";
import {
  makeEntry,
  makeItem,
  makeObservation,
  makeRun,
  makeUser,
  NOW,
  resetTables,
  syncRunConditions,
} from "./helpers";
import {
  DAY,
  HOUR,
  FEELS_LIKE_C,
  PLACE,
  seedEntry,
  seedObservation,
} from "./scaling-fixture";

/**
 * Design 182: the conditions consensus's query count must not grow with
 * the runners in it. Since #409 it reads the copy of each run's conditions
 * in core (D-175), so it asks the weather database nothing, and its rows
 * read grow with the runs that match, not with the window (#507, below).
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
    await syncRunConditions();
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
  const chunks = Math.ceil(entries / IN_LIST_CHUNK);
  // The matching entries, found by the copy of their runs' conditions in
  // core (D-175), then `wornByRunner`'s two chunked reads: the kit rows of
  // the matching entries and their garments, 80 ids a statement. Nothing
  // is asked of the weather database: the copy holds what it answered.
  return { core: 1 + 2 * chunks, weather: 0 };
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

/**
 * #507: the rows the consensus reads, beside rows it must not return.
 * Statement counts cannot tell a read that reads what it shows from one
 * that reads everything near it, so these count rows read, with one
 * matching runner and then with twenty-five unrelated rows added.
 */

/**
Another cell, where it felt 13° warmer than the viewer's band.
*/
const ELSEWHERE = { lat: 45.5, lng: -94.1 };
const TWENTY_DAYS = 20 * DAY;

/**
One runner's shared run and entry at `place`, `ago` seconds back.
*/
async function unrelatedEntry(params: {
  place: { lat: number; lng: number };
  ago: number;
  audience: "runners" | "private";
}): Promise<void> {
  const userId = await makeUser();
  const at = NOW - params.ago;
  const runId = await makeRun({
    userId,
    ...params.place,
    startedAt: at,
    durationS: 60,
  });
  await makeEntry({
    userId,
    runId,
    createdAt: at,
    verdict: 0,
    audience: params.audience,
  });
}

/**
The observation at `ELSEWHERE`, an hour back.
*/
async function observedElsewhere(): Promise<void> {
  await makeObservation({
    ...ELSEWHERE,
    startedAt: NOW - HOUR,
    tempC: 20,
    feelsLikeC: FEELS_LIKE_C + 13,
  });
}

/**
The three kinds of row the consensus must not return.
*/
async function sharedElsewhere(): Promise<void> {
  await unrelatedEntry({ place: ELSEWHERE, ago: HOUR, audience: "runners" });
}
async function privateInBand(): Promise<void> {
  await unrelatedEntry({ place: PLACE, ago: HOUR, audience: "private" });
}
async function sharedLongAgo(): Promise<void> {
  await unrelatedEntry({ place: PLACE, ago: TWENTY_DAYS, audience: "runners" });
}

/**
 * One matching runner, `unrelated` copies of `noise`, and what one
 * `matchTally` over the 3-day window asked. The tally must still find
 * exactly the one runner, so a seed that matched cannot pass as noise.
 */
async function tallyBeside(
  unrelated: number,
  noise: () => Promise<void>,
  setup?: () => Promise<void>,
) {
  await resetTables();
  await setup?.();
  await seedRunners(1, HOUR);
  for (let index = 0; index < unrelated; index += 1) await noise();
  await syncRunConditions();
  let runners: number | undefined;
  const counts = await queryCounts(async () => {
    const tally = await matchTally(VIEWER, NOW - 3 * DAY);
    runners = tally.runners;
  });
  expect(runners).toBe(1);
  return counts;
}

describe("matchTally: rows read beside rows it must not return (#507)", () => {
  it("reads no more for 25 shared runs outside the window", async () => {
    const none = await tallyBeside(0, sharedLongAgo);
    const many = await tallyBeside(25, sharedLongAgo);
    expect(many.coreRowsRead).toBe(none.coreRowsRead);
    expect(many.weatherRowsRead).toBe(none.weatherRowsRead);
  });

  it("reads no more for 25 shared runs that felt 13° warmer (#409)", async () => {
    // Before #409 this read every shared entry in the window, then each
    // one's run and cache cell, and grew by at least two rows a run. The
    // copy's band index (D-175) offers only the runs in the band.
    // One against twenty-five, not none: the band's range seek reads the
    // row just past it, so the first run elsewhere costs one row whatever
    // follows it.
    const one = await tallyBeside(1, sharedElsewhere, observedElsewhere);
    const many = await tallyBeside(25, sharedElsewhere, observedElsewhere);
    expect(many.coreRowsRead).toBe(one.coreRowsRead);
    expect(many.weatherRowsRead).toBe(one.weatherRowsRead);
  });

  it("reads no more for 25 private entries in the band", async () => {
    // The window's index is partial on the shared audiences, so a private
    // entry is never read at all. Whatever bounds the read by band must
    // keep that, or private runs would cost every viewer in their band.
    const none = await tallyBeside(0, privateInBand);
    const many = await tallyBeside(25, privateInBand);
    expect(many.coreRowsRead).toBe(none.coreRowsRead);
    expect(many.weatherRowsRead).toBe(none.weatherRowsRead);
  });
});

beforeEach(resetTables);
