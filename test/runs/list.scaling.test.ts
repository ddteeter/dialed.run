import { beforeEach, describe, expect, it } from "vitest";

import { outfitEntries, runs } from "../../src/db/schema-core";
import { newUlid } from "../../src/lib/ids";
import { coreDb } from "../../src/modules/runs/core-db";
import { listRunSummaries } from "../../src/modules/runs/service";
import { CELLS_PER_READ } from "../../src/modules/weather/read";
import { queryCounts } from "../d1-spy";
import { makeObservation, resetTables } from "../feed/helpers";

/**
 * The runs list costs the same statements for one run as for twenty-five
 * (design 182, part 1): the runs, their entries, and their conditions,
 * each read for the whole list at once.
 *
 * Every run starts within the same hour at the same place, so all of
 * them land in one weather cache cell with one observation in it: the
 * subject here is the runs, not the weather.
 */

const START = 1_755_000_000;
const LAT = 44.98;
const LNG = -93.27;

beforeEach(async () => {
  await resetTables();
  await makeObservation({
    lat: LAT,
    lng: LNG,
    startedAt: START,
    tempC: 5,
    feelsLikeC: 2,
  });
});

/**
`count` located runs in one cache cell, each with a judged entry.
*/
async function runnerWith(count: number): Promise<string> {
  const userId = newUlid();
  for (let index = 0; index < count; index += 1) {
    const runId = newUlid();
    await coreDb()
      .insert(runs)
      .values({
        id: runId,
        userId,
        source: "file",
        startedAt: START + index,
        durationS: 3098,
        distanceM: 9978,
        title: "Morning run",
        lat: LAT,
        lng: LNG,
        weatherStatus: "attached",
      });
    await coreDb()
      .insert(outfitEntries)
      .values({
        id: newUlid(),
        userId,
        runId,
        verdict: 0,
        audience: "runners",
        createdAt: START + index,
      });
  }
  return userId;
}

/**
The list's counts, and how many of its runs came back with conditions.
*/
async function countedList(userId: string) {
  let listed = 0;
  let withConditions = 0;
  let withEntry = 0;
  const counts = await queryCounts(async () => {
    const summaries = await listRunSummaries(coreDb(), userId);
    listed = summaries.length;
    withConditions = summaries.filter((run) => run.conditions).length;
    withEntry = summaries.filter((run) => run.hasVerdict).length;
  });
  return { counts, listed, withConditions, withEntry };
}

describe("listRunSummaries", () => {
  it("reads 1 and 25 runs in the same statements", async () => {
    const one = await countedList(await runnerWith(1));
    expect(one).toMatchObject({ listed: 1, withConditions: 1, withEntry: 1 });

    const twentyFive = await countedList(await runnerWith(25));
    expect(twentyFive).toMatchObject({
      listed: 25,
      withConditions: 25,
      withEntry: 25,
    });

    // Core: the runs, their entries, and the weather read's own lookup of
    // the runs' places (observationsForRuns, src/modules/weather/read.ts:84).
    // Weather: the cache cells and the runner-set bands.
    expect(one.counts.core).toBe(3);
    expect(one.counts.weather).toBe(2);
    expect(twentyFive.counts.core).toBe(one.counts.core);
    expect(twentyFive.counts.weather).toBe(one.counts.weather);
    expect(twentyFive.counts.coreRowsRead).toBeGreaterThan(
      one.counts.coreRowsRead,
    );
  });

  it("reads the weather cache once per 30 runs, and core no more", async () => {
    // Legitimate scaling: a cache cell is three bound parameters, so
    // CELLS_PER_READ (src/modules/weather/read.ts) runs go in one
    // statement under D1's hundred-parameter cap. The list stops at 50, so
    // it is at most two. Core's IN lists chunk at IN_LIST_CHUNK = 80
    // (src/lib/chunked.ts:43), past the list's cap, so core stays flat.
    const thirty = await countedList(await runnerWith(CELLS_PER_READ));
    const thirtyOne = await countedList(await runnerWith(CELLS_PER_READ + 1));
    expect(thirtyOne.listed).toBe(CELLS_PER_READ + 1);
    expect(thirtyOne.withConditions).toBe(CELLS_PER_READ + 1);

    expect(thirtyOne.counts.core).toBe(thirty.counts.core);
    expect(thirtyOne.counts.weather).toBe(thirty.counts.weather + 1);
  });
});
