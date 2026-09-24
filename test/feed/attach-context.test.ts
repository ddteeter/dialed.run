import { beforeEach, describe, expect, it } from "vitest";

import {
  attachContext,
  attachRunInput,
  prefillForRun,
} from "../../src/modules/feed/attach-context";
import {
  makeEntry,
  makeItem,
  makeObservation,
  makeRun,
  makeUser,
  NOW,
  resetTables,
} from "./helpers";

/**
 * A2 reads the run's own GPS and time, never the device's (round 22). Both
 * halves are keyed by the run, and both answer nothing for a run that is
 * not the viewer's — the same answer as a run that is not there.
 */

const LAT = 44.98;
const LNG = -93.27;

beforeEach(async () => {
  await resetTables();
});

describe("attachRunInput", () => {
  it("takes a run id and nothing looser", () => {
    expect(
      attachRunInput.safeParse({ runId: "01HQA00000000000000000000A" }).success,
    ).toBe(true);
    expect(attachRunInput.safeParse({ runId: "nope" }).success).toBe(false);
    expect(attachRunInput.safeParse({}).success).toBe(false);
  });
});

describe("attachContext", () => {
  it("returns the run's distance, its own conditions, and the closet grouped", async () => {
    const userId = await makeUser();
    const runId = await makeRun({ userId, lat: LAT, lng: LNG });
    await makeObservation({
      lat: LAT,
      lng: LNG,
      startedAt: NOW,
      tempC: 5,
      feelsLikeC: 3,
      precipMm: 1,
    });
    const itemId = await makeItem({ userId, name: "Houdini" });

    const context = await attachContext(userId, runId);

    expect(context?.distanceM).toBe(5000);
    expect(context?.conditions?.tempC).toBe(5);
    expect(context?.conditions?.precipMm).toBe(1);
    expect(context?.groups).toHaveLength(1);
    expect(context?.groups[0]?.group).toBe("tops");
    expect(context?.groups[0]?.items.map((item) => item.id)).toEqual([itemId]);
  });

  it("has no conditions for a run nothing was observed for, and still the closet", async () => {
    const userId = await makeUser();
    const runId = await makeRun({ userId, lat: LAT, lng: LNG });
    await makeItem({ userId });

    const context = await attachContext(userId, runId);

    expect(context?.conditions).toBeUndefined();
    expect(context?.groups).toHaveLength(1);
  });

  it("answers nothing for someone else's run, as for a missing one", async () => {
    const owner = await makeUser();
    const stranger = await makeUser();
    const runId = await makeRun({ userId: owner });

    expect(await attachContext(stranger, runId)).toBeUndefined();
    expect(
      await attachContext(owner, "01HQA00000000000000000000Z"),
    ).toBeUndefined();
  });
});

describe("prefillForRun", () => {
  it("suggests the runner's nearest past kit to this run's own conditions", async () => {
    const userId = await makeUser();
    const itemId = await makeItem({ userId });
    // A past run at 4° feels-like, and a kit worn on it.
    const pastRun = await makeRun({
      userId,
      lat: 41.11,
      lng: LNG,
      startedAt: NOW - 86_400,
    });
    await makeObservation({
      lat: 41.11,
      lng: LNG,
      startedAt: NOW - 86_400,
      tempC: 6,
      feelsLikeC: 4,
    });
    const pastEntry = await makeEntry({
      userId,
      runId: pastRun,
      createdAt: NOW - 86_400,
      itemIds: [itemId],
    });
    // This run, at 3°.
    const runId = await makeRun({ userId, lat: LAT, lng: LNG });
    await makeObservation({
      lat: LAT,
      lng: LNG,
      startedAt: NOW,
      tempC: 5,
      feelsLikeC: 3,
    });

    const suggestion = await prefillForRun(userId, runId);

    expect(suggestion?.entryId).toBe(pastEntry);
    expect(suggestion?.itemIds).toEqual([itemId]);
    expect(suggestion?.feelsLikeDeltaC).toBe(1);
  });

  it("suggests nothing for a run with no conditions to be near", async () => {
    const userId = await makeUser();
    const pastRun = await makeRun({ userId, lat: 41.11, startedAt: NOW - 1 });
    await makeObservation({
      lat: 41.11,
      lng: LNG,
      startedAt: NOW - 1,
      tempC: 5,
      feelsLikeC: 3,
    });
    await makeEntry({ userId, runId: pastRun });
    const runId = await makeRun({ userId, lat: 50.5 });

    expect(await prefillForRun(userId, runId)).toBeUndefined();
  });

  it("suggests nothing from someone else's run", async () => {
    const owner = await makeUser();
    const stranger = await makeUser();
    const runId = await makeRun({ userId: owner, lat: LAT, lng: LNG });
    await makeObservation({
      lat: LAT,
      lng: LNG,
      startedAt: NOW,
      tempC: 5,
      feelsLikeC: 3,
    });
    await makeEntry({
      userId: stranger,
      runId: await makeRun({ userId: stranger }),
    });

    expect(await prefillForRun(stranger, runId)).toBeUndefined();
  });
});
