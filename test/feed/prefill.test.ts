import { beforeEach, describe, expect, it } from "vitest";

import { nearestPriorEntry } from "../../src/modules/feed/prefill";
import type { Conditions } from "../../src/modules/feed/conditions";
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
 * A2 prefill: "MOST LIKELY · FROM 43° DAMP, AUG 14" — the runner's own most
 * recent entry from the nearest conditions. Thirty-nine mutants, none
 * covered.
 *
 * Getting this wrong is not a crash. It is the app confidently suggesting
 * the kit someone wore in the rain for a dry run, or the closest match
 * from six months ago when last week's is just as close.
 */

const HOURS = 3600;

function conditions(): Conditions {
  return {
    tempC: 5,
    feelsLikeC: 3,
    precipMm: 0,
    windKph: 10,
    condition: "clear",
    source: "visualcrossing",
    span: { minTempC: 5, maxTempC: 5, minFeelsLikeC: 3, maxFeelsLikeC: 3 },
  };
}

/**
An entry of the runner's own, at a place with a known observation.
*/
async function priorEntry(params: {
  userId: string;
  lat: number;
  feelsLikeC: number;
  precipMm?: number;
  createdAt?: number;
  itemIds?: string[];
}): Promise<string> {
  const startedAt = params.createdAt ?? NOW;
  const runId = await makeRun({
    userId: params.userId,
    lat: params.lat,
    lng: -93.27,
    startedAt,
  });
  await makeObservation({
    lat: params.lat,
    lng: -93.27,
    startedAt,
    tempC: params.feelsLikeC + 2,
    feelsLikeC: params.feelsLikeC,
    precipMm: params.precipMm ?? 0,
  });
  return makeEntry({
    userId: params.userId,
    runId,
    createdAt: startedAt,
    itemIds: params.itemIds ?? [],
  });
}

/**
 * An entry on a run that spans two hours: it set out at `startC` and its
 * second hour felt like `laterC`, rated `verdict`.
 */
async function twoHourEntry(params: {
  userId: string;
  lat: number;
  startC: number;
  laterC: number;
  verdict: number;
}): Promise<string> {
  const runId = await makeRun({
    userId: params.userId,
    lat: params.lat,
    lng: -93.27,
    startedAt: NOW,
    durationS: 2 * HOURS,
  });
  for (const [offset, feelsLikeC] of [
    [0, params.startC],
    [HOURS, params.laterC],
  ] as const) {
    await makeObservation({
      lat: params.lat,
      lng: -93.27,
      startedAt: NOW + offset,
      tempC: feelsLikeC + 2,
      feelsLikeC,
      precipMm: 0,
    });
  }
  return makeEntry({
    userId: params.userId,
    runId,
    createdAt: NOW,
    verdict: params.verdict,
  });
}

beforeEach(async () => {
  await resetTables();
});

describe("nearestPriorEntry", () => {
  it("suggests nothing to a runner with no history", async () => {
    expect(
      await nearestPriorEntry(await makeUser(), conditions()),
    ).toBeUndefined();
  });

  it("suggests nothing when no prior run has a resolved observation", async () => {
    // An entry with unknown conditions cannot be compared to today's.
    const userId = await makeUser();
    const runId = await makeRun({ userId, lat: 41.11 });
    await makeEntry({ userId, runId });

    expect(await nearestPriorEntry(userId, conditions())).toBeUndefined();
  });

  it("picks the entry closest in feels-like, not the most recent", async () => {
    const userId = await makeUser();
    const far = await priorEntry({
      userId,
      lat: 41.11,
      feelsLikeC: 20,
      createdAt: NOW,
    });
    const near = await priorEntry({
      userId,
      lat: 42.22,
      feelsLikeC: 4,
      createdAt: NOW - 30 * 24 * HOURS,
    });

    const suggestion = await nearestPriorEntry(userId, conditions());

    expect(suggestion?.entryId).toBe(near);
    expect(suggestion?.entryId).not.toBe(far);
    expect(suggestion?.feelsLikeDeltaC).toBe(1);
  });

  it("breaks a tie towards the more recent entry", async () => {
    // Two runs equally close in temperature: the one they remember is the
    // one they did last week.
    const userId = await makeUser();
    await priorEntry({
      userId,
      lat: 43.33,
      feelsLikeC: 1,
      createdAt: NOW - 90 * 24 * HOURS,
    });
    const recent = await priorEntry({
      userId,
      lat: 44.44,
      feelsLikeC: 5,
      createdAt: NOW - 7 * 24 * HOURS,
    });

    const suggestion = await nearestPriorEntry(userId, conditions());

    expect(suggestion?.entryId).toBe(recent);
  });

  it("only compares runs in the same precipitation class", async () => {
    // What you wear in the rain is a different question from what you wear
    // at the same temperature in the dry.
    const userId = await makeUser();
    await priorEntry({ userId, lat: 45.55, feelsLikeC: 3, precipMm: 8 });
    const dry = await priorEntry({
      userId,
      lat: 46.66,
      feelsLikeC: 12,
      precipMm: 0,
    });

    const suggestion = await nearestPriorEntry(userId, conditions());

    expect(suggestion?.entryId).toBe(dry);
  });

  it("suggests nothing when every prior run was in another precipitation class", async () => {
    const userId = await makeUser();
    await priorEntry({ userId, lat: 47.77, feelsLikeC: 3, precipMm: 8 });

    expect(await nearestPriorEntry(userId, conditions())).toBeUndefined();
  });

  it("carries the kit that was worn, and the conditions it was worn in", async () => {
    // The suggestion is only useful if it names the pieces; the conditions
    // are what the "FROM 43° DAMP" label is built from.
    const userId = await makeUser();
    const shirt = await makeItem({ userId, name: "Prefill shirt" });
    const shorts = await makeItem({ userId, name: "Prefill shorts" });
    await priorEntry({
      userId,
      lat: 48.88,
      feelsLikeC: 4,
      itemIds: [shirt, shorts],
    });

    const suggestion = await nearestPriorEntry(userId, conditions());

    expect(new Set(suggestion?.itemIds)).toStrictEqual(
      new Set([shirt, shorts]),
    );
    expect(suggestion?.conditions.feelsLikeC).toBe(4);
  });

  it("never suggests another runner's entry", async () => {
    const mine = await makeUser();
    const theirs = await makeUser();
    await priorEntry({ userId: theirs, lat: 49.99, feelsLikeC: 3 });

    expect(await nearestPriorEntry(mine, conditions())).toBeUndefined();
  });

  describe("reads each past run at its worst hour (D-165)", () => {
    // The target (today's run, 3°) is unrated, so it is its starting hour.
    // A past run is read where its own conditions are judged: the coldest
    // hour of one that felt cold, the warmest of one that felt warm, and
    // the starting hour of one that was dialed.
    it("a run that felt cold is matched at its coldest hour", async () => {
      const userId = await makeUser();
      // Set out at exactly 3° but froze at -4°: 7 away, not 0.
      const cold = await twoHourEntry({
        userId,
        lat: 51.11,
        startC: 3,
        laterC: -4,
        verdict: -1,
      });
      const steady = await priorEntry({ userId, lat: 52.22, feelsLikeC: 6 });

      const suggestion = await nearestPriorEntry(userId, conditions());

      expect(suggestion?.entryId).toBe(steady);
      expect(suggestion?.entryId).not.toBe(cold);
      expect(suggestion?.feelsLikeDeltaC).toBe(3);
    });

    it("a run that felt warm is matched at its warmest hour", async () => {
      const userId = await makeUser();
      // Set out at -5° (8 away) and warmed to 4° (1 away).
      const warm = await twoHourEntry({
        userId,
        lat: 53.33,
        startC: -5,
        laterC: 4,
        verdict: 2,
      });
      await priorEntry({ userId, lat: 54.44, feelsLikeC: 6 });

      const suggestion = await nearestPriorEntry(userId, conditions());

      expect(suggestion?.entryId).toBe(warm);
      expect(suggestion?.feelsLikeDeltaC).toBe(1);
    });

    it("a dialed run is matched at the hour it set out in", async () => {
      const userId = await makeUser();
      const dialed = await twoHourEntry({
        userId,
        lat: 55.55,
        startC: 3,
        laterC: -4,
        verdict: 0,
      });
      await priorEntry({ userId, lat: 56.66, feelsLikeC: 6 });

      const suggestion = await nearestPriorEntry(userId, conditions());

      expect(suggestion?.entryId).toBe(dialed);
      expect(suggestion?.feelsLikeDeltaC).toBe(0);
    });
  });
});
