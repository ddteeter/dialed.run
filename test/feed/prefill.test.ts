import { beforeEach, describe, expect, it } from "vitest";

import { nearestPriorEntry, prefillAt } from "../../src/modules/feed/prefill";
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

function conditions(overrides: Partial<Conditions> = {}): Conditions {
  return {
    tempC: 5,
    feelsLikeC: 3,
    precipMm: 0,
    windKph: 10,
    condition: "clear",
    source: "visualcrossing",
    ...overrides,
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
});

describe("prefillAt", () => {
  it("suggests nothing when the conditions there cannot be resolved", async () => {
    // A prefill with no conditions has nothing to be near, so the form
    // falls back to the picker rather than offering a guess. The runner
    // has history — without it the lookup would stop before the
    // conditions ever mattered.
    const userId = await makeUser();
    await priorEntry({ userId, lat: 70.11, feelsLikeC: 3 });

    expect(await prefillAt(userId, 73.11, -93.27, NOW)).toBeUndefined();
  });

  it("suggests the nearest prior entry once the conditions are known", async () => {
    const userId = await makeUser();
    await priorEntry({ userId, lat: 71.11, feelsLikeC: 3 });
    await makeObservation({
      lat: 72.11,
      lng: -93.27,
      startedAt: NOW,
      tempC: 5,
      feelsLikeC: 3,
    });

    const suggestion = await prefillAt(userId, 72.11, -93.27, NOW);

    expect(suggestion?.feelsLikeDeltaC).toBe(0);
  });
});
