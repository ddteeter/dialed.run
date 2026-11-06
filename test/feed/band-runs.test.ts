import { beforeEach, describe, expect, it } from "vitest";

import {
  bandRunsInput,
  recentRunsInBand,
} from "../../src/modules/feed/band-runs";
import {
  makeEntry,
  makeItem,
  makeObservation,
  makeRun,
  makeUser,
  resetTables,
  NOW,
} from "./helpers";

/**
 * The band history on A2's and A3's desk rails (round 25): the runner's
 * last three verdicted runs in the band, each dated, with its conditions,
 * verdict and pieces. Over real D1, because the band comes from the
 * weather database and the kit from the core one.
 */

const DAY = 86_400;
/**
A one-hour run judges at its own feels-like: 7°C is the 5–10° band.
*/
const IN_BAND = 7;
const BAND = 5;

/**
A run at its own place, observed at `feelsLikeC`.
*/
async function runAt(
  userId: string,
  lat: number,
  feelsLikeC: number,
  options: Readonly<{ startedAt?: number; timeZone?: string }> = {},
): Promise<string> {
  const startedAt = options.startedAt ?? NOW;
  const runId = await makeRun({ userId, lat, lng: -87.6, startedAt });
  await makeObservation({
    lat,
    lng: -87.6,
    startedAt,
    tempC: feelsLikeC + 1,
    feelsLikeC,
    ...(options.timeZone !== undefined && { timeZone: options.timeZone }),
  });
  return runId;
}

beforeEach(async () => {
  await resetTables();
});

describe("recentRunsInBand", () => {
  it("is the last three verdicted runs in the band, newest first", async () => {
    const userId = await makeUser();
    const ids: string[] = [];
    for (let index = 0; index < 4; index += 1) {
      ids.push(
        await makeEntry({
          userId,
          runId: await runAt(userId, 41 + index / 10, IN_BAND, {
            startedAt: NOW - index * DAY,
          }),
          verdict: 0,
          createdAt: NOW - index * DAY,
        }),
      );
    }

    const rows = await recentRunsInBand(userId, BAND);

    expect(rows.map((row) => row.id)).toEqual(ids.slice(0, 3));
  });

  it("leaves out other bands, unjudged runs, other runners and the entry being judged", async () => {
    const userId = await makeUser();
    const other = await makeUser();
    const kept = await makeEntry({
      userId,
      runId: await runAt(userId, 42.1, IN_BAND),
      verdict: -1,
    });
    const judged = await makeEntry({
      userId,
      runId: await runAt(userId, 42.2, IN_BAND),
      verdict: 0,
    });
    await makeEntry({
      userId,
      runId: await runAt(userId, 42.3, 20),
      verdict: 0,
    });
    await makeEntry({ userId, runId: await runAt(userId, 42.4, IN_BAND) });
    await makeEntry({
      userId: other,
      runId: await runAt(other, 42.5, IN_BAND),
      verdict: 0,
    });
    // No observation: no band to be in.
    await makeEntry({
      userId,
      runId: await makeRun({ userId, lat: 42.6, lng: -87.6 }),
      verdict: 0,
    });

    const rows = await recentRunsInBand(userId, BAND, judged);

    expect(rows.map((row) => row.id)).toEqual([kept]);
  });

  it("dates each run where it was run, and carries its conditions and verdict", async () => {
    const userId = await makeUser();
    // 15:33 UTC on Thu 4 Sep is already Fri 5 Sep in Tokyo.
    const tokyo = await makeEntry({
      userId,
      runId: await runAt(userId, 43.1, IN_BAND, { timeZone: "Asia/Tokyo" }),
      verdict: -1,
      createdAt: NOW,
    });
    const utc = await makeEntry({
      userId,
      runId: await runAt(userId, 43.2, IN_BAND, { startedAt: NOW - DAY }),
      verdict: 2,
      createdAt: NOW - DAY,
    });

    const [first, second] = await recentRunsInBand(userId, BAND);

    expect(first).toMatchObject({
      id: tokyo,
      day: "Sep 5",
      verdict: -1,
      conditions: { feelsLikeC: IN_BAND, tempC: IN_BAND + 1 },
    });
    expect(second).toMatchObject({ id: utc, day: "Sep 3", verdict: 2 });
  });

  it("names the pieces worn on each run, and only those", async () => {
    const userId = await makeUser();
    const harrier = await makeItem({ userId, name: "Harrier" });
    const split = await makeItem({ userId, name: "Bandit Split" });
    const gloves = await makeItem({ userId, name: "Thin gloves" });
    await makeEntry({
      userId,
      runId: await runAt(userId, 44.1, IN_BAND),
      verdict: 0,
      itemIds: [split, harrier],
      createdAt: NOW,
    });
    await makeEntry({
      userId,
      runId: await runAt(userId, 44.2, IN_BAND, { startedAt: NOW - DAY }),
      verdict: 0,
      itemIds: [gloves],
      createdAt: NOW - DAY,
    });
    await makeEntry({
      userId,
      runId: await runAt(userId, 44.3, IN_BAND, { startedAt: NOW - 2 * DAY }),
      verdict: 0,
      createdAt: NOW - 2 * DAY,
    });

    const rows = await recentRunsInBand(userId, BAND);

    // In the order of their ids, which two ULIDs minted in one
    // millisecond do not fix: so the expectation is sorted the same way.
    expect(rows[0]?.pieces.map((piece) => piece.itemId)).toEqual(
      [harrier, split].toSorted((a, b) => a.localeCompare(b)),
    );
    const named = new Map([
      [harrier, "Harrier"],
      [split, "Bandit Split"],
    ]);
    expect(rows.map((row) => row.pieces.map((piece) => piece.name))).toEqual([
      [harrier, split]
        .toSorted((a, b) => a.localeCompare(b))
        .map((id) => named.get(id)),
      ["Thin gloves"],
      [],
    ]);
  });

  it("answers nothing for a band with no runs in it", async () => {
    const userId = await makeUser();
    await makeEntry({
      userId,
      runId: await runAt(userId, 45.1, 20),
      verdict: 0,
    });

    expect(await recentRunsInBand(userId, BAND)).toEqual([]);
  });
});

describe("bandRunsInput", () => {
  it("takes a band, and an entry to leave out only as a ULID", () => {
    expect(bandRunsInput.parse({ bandFloorC: 5 })).toStrictEqual({
      bandFloorC: 5,
    });
    expect(
      bandRunsInput.parse({
        bandFloorC: -5,
        excludeEntryId: "01M6S6XDWJWNPWYGWZB3N40V0G",
      }),
    ).toStrictEqual({
      bandFloorC: -5,
      excludeEntryId: "01M6S6XDWJWNPWYGWZB3N40V0G",
    });
    expect(bandRunsInput.safeParse({}).success).toBe(false);
    expect(bandRunsInput.safeParse({ bandFloorC: "5" }).success).toBe(false);
    expect(
      bandRunsInput.safeParse({ bandFloorC: 5, excludeEntryId: "x" }).success,
    ).toBe(false);
  });
});
