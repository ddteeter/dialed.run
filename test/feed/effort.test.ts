import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";

import { runs } from "../../src/db/schema-core";
import { coreDb } from "../../src/env";
import {
  attachKit,
  getEntryDetail,
  submitVerdict,
} from "../../src/modules/feed/entries";
import { makeRun, makeUser, resetTables } from "./helpers";

/**
 * A3's effort (design G5): the watch's prefill is the run's until the
 * runner taps, and the tap lands in the verdict's own batch as theirs.
 */

async function effortOf(entryId: string, viewerId: string) {
  const detail = await getEntryDetail(entryId, viewerId);
  return detail?.effort;
}

beforeEach(async () => {
  await resetTables();
});

async function watchRatedEntry(): Promise<{
  userId: string;
  runId: string;
  entryId: string;
}> {
  const userId = await makeUser();
  const runId = await makeRun({ userId });
  await coreDb()
    .update(runs)
    .set({ rpe: 6, effort: "steady", effortSource: "watch" })
    .where(eq(runs.id, runId));
  const entryId = await attachKit({ userId, runId, itemIds: [] });
  return { userId, runId, entryId };
}

async function storedEffort(runId: string) {
  const [row] = await coreDb()
    .select({
      rpe: runs.rpe,
      effort: runs.effort,
      effortSource: runs.effortSource,
    })
    .from(runs)
    .where(eq(runs.id, runId));
  return row;
}

const verdict = {
  verdict: 0,
  audience: "private",
  tags: [],
  itemFlags: [],
} as const;

describe("submitVerdict and the run's effort", () => {
  it("leaves the watch's effort alone when the runner did not tap", async () => {
    const { userId, runId, entryId } = await watchRatedEntry();

    await submitVerdict({ userId, entryId, ...verdict });

    expect(await storedEffort(runId)).toEqual({
      rpe: 6,
      effort: "steady",
      effortSource: "watch",
    });
  });

  it("stores a tap as the runner's own pick, and keeps the watch's rating", async () => {
    const { userId, runId, entryId } = await watchRatedEntry();

    await submitVerdict({ userId, entryId, ...verdict, effort: "race" });

    expect(await storedEffort(runId)).toEqual({
      rpe: 6,
      effort: "race",
      effortSource: "runner",
    });
  });
});

describe("the entry detail's effort", () => {
  it("gives the author the effort and, while it stands, the watch's rating", async () => {
    const { userId, entryId } = await watchRatedEntry();

    expect(await effortOf(entryId, userId)).toEqual({
      chosen: "steady",
      watchRpe: 6,
    });
  });

  it("drops the rating once the pick is the runner's", async () => {
    const { userId, entryId } = await watchRatedEntry();
    await submitVerdict({ userId, entryId, ...verdict, effort: "easy" });

    expect(await effortOf(entryId, userId)).toEqual({
      chosen: "easy",
      watchRpe: undefined,
    });
  });

  it("is empty for a run nothing has rated", async () => {
    const userId = await makeUser();
    const runId = await makeRun({ userId });
    const entryId = await attachKit({ userId, runId, itemIds: [] });

    expect(await effortOf(entryId, userId)).toEqual({
      chosen: undefined,
      watchRpe: undefined,
    });
  });

  it("is the author's only", async () => {
    const { userId, entryId } = await watchRatedEntry();
    await submitVerdict({
      userId,
      entryId,
      ...verdict,
      audience: "runners",
    });

    const viewer = await makeUser();
    const detail = await getEntryDetail(entryId, viewer);
    expect(detail).toBeDefined();
    expect(detail?.effort).toBeUndefined();
  });
});
