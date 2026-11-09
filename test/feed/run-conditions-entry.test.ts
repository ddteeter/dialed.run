import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/d1";
import { beforeEach, describe, expect, it } from "vitest";

import {
  outfitEntries,
  runConditions,
  userProfiles,
} from "../../src/db/schema-core";
import { env } from "../../src/env";
import { isStrangerAudience } from "../../src/lib/contracts";
import { attachKit, submitVerdict } from "../../src/modules/feed/entries";
import { deleteRuns, retractEntries } from "../../src/modules/feed/retract";
import { makeRun, makeVerifiedUser, resetTables } from "./helpers";

/**
 * Feed's half of `run_conditions` (D-175, design 189): the entry's
 * verdict, time and whether it is shared, written in the batch that
 * writes the entry, cleared with the entry, deleted with the run.
 */

function core() {
  return drizzle(env.DIALED_CORE);
}

function quiet(): void {
  /*
   * The retract paths report what they could not reach; nothing here is.
   */
}

function nothingToPurge(): void {
  /*
   * No public page names these kits.
   */
}

async function copyOf(runId: string) {
  const [row] = await core()
    .select()
    .from(runConditions)
    .where(eq(runConditions.runId, runId));
  return row;
}

/**
 * Asserts the entry half of the run's copy is what the entry row says:
 * pinned against the row, not restated.
 */
async function expectCopiesEntry(runId: string) {
  const [entry] = await core()
    .select()
    .from(outfitEntries)
    .where(eq(outfitEntries.runId, runId));
  if (entry === undefined) throw new Error("no entry");
  const row = await copyOf(runId);
  expect(row).toMatchObject({
    userId: entry.userId,
    verdict: entry.verdict,
    entryCreatedAt: entry.createdAt,
    entryShared: isStrangerAudience(entry.audience),
  });
  return row;
}

async function runOf(userId: string) {
  return makeRun({ userId });
}

beforeEach(async () => {
  await resetTables();
  await core().delete(runConditions);
});

describe("the entry half, written with the entry", () => {
  it("is written as a kit is attached, shared by the runner's default", async () => {
    const userId = await makeVerifiedUser();
    const runId = await runOf(userId);
    await attachKit({ userId, runId, itemIds: [] });
    const row = await expectCopiesEntry(runId);
    expect(row?.entryShared).toBe(true);
    expect(row?.verdict).toBeNull();
    expect(row?.feelsLikeC).toBeNull();
  });

  it("is not shared for a runner whose default is private", async () => {
    const userId = await makeVerifiedUser();
    await core()
      .update(userProfiles)
      .set({ defaultAudience: "private" })
      .where(eq(userProfiles.userId, userId));
    const runId = await runOf(userId);
    await attachKit({ userId, runId, itemIds: [] });
    const row = await expectCopiesEntry(runId);
    expect(row?.entryShared).toBe(false);
  });

  it("carries a verdict stamped as the kit is attached, and a replayed one", async () => {
    const userId = await makeVerifiedUser();
    const runId = await runOf(userId);
    await attachKit({ userId, runId, itemIds: [], verdict: -1 });
    const first = await expectCopiesEntry(runId);
    expect(first?.verdict).toBe(-1);
    // The same Enter again, with a different verdict: the entry exists.
    await attachKit({ userId, runId, itemIds: [], verdict: 2 });
    const replayed = await expectCopiesEntry(runId);
    expect(replayed?.verdict).toBe(2);
  });

  it("follows the verdict and the audience a save writes, both ways", async () => {
    const userId = await makeVerifiedUser();
    const runId = await runOf(userId);
    const entryId = await attachKit({ userId, runId, itemIds: [] });
    const save = {
      userId,
      entryId,
      tags: [],
      itemFlags: [],
    };
    await submitVerdict({ ...save, verdict: 1, audience: "private" });
    expect(await expectCopiesEntry(runId)).toMatchObject({
      verdict: 1,
      entryShared: false,
    });
    await submitVerdict({ ...save, verdict: -2, audience: "runners" });
    expect(await expectCopiesEntry(runId)).toMatchObject({
      verdict: -2,
      entryShared: true,
    });
  });

  it("leaves weather's half as it was", async () => {
    const userId = await makeVerifiedUser();
    const runId = await runOf(userId);
    await core().insert(runConditions).values({
      runId,
      userId,
      feelsLikeC: 3,
      minFeelsLikeC: 1,
      maxFeelsLikeC: 5,
      precipClass: "damp",
      source: "visualcrossing",
    });
    await attachKit({ userId, runId, itemIds: [], verdict: 0 });
    expect(await copyOf(runId)).toMatchObject({
      feelsLikeC: 3,
      minFeelsLikeC: 1,
      maxFeelsLikeC: 5,
      precipClass: "damp",
      source: "visualcrossing",
      verdict: 0,
      entryShared: true,
    });
  });
});

describe("the copy as entries and runs go", () => {
  it("clears the entry half when the entry is retracted, and keeps the run's", async () => {
    const userId = await makeVerifiedUser();
    const runId = await runOf(userId);
    const entryId = await attachKit({ userId, runId, itemIds: [], verdict: 1 });
    await core()
      .update(runConditions)
      .set({ feelsLikeC: 6 })
      .where(eq(runConditions.runId, runId));

    await retractEntries(core(), userId, [entryId], quiet, nothingToPurge);

    const row = await copyOf(runId);
    expect(row?.feelsLikeC).toBe(6);
    expect(row?.verdict).toBeNull();
    expect(row?.entryCreatedAt).toBeNull();
    expect(row?.entryShared).toBe(false);
  });

  it("deletes the copy with the run, and no one else's", async () => {
    const userId = await makeVerifiedUser();
    const other = await makeVerifiedUser();
    const runId = await runOf(userId);
    const theirs = await runOf(other);
    await attachKit({ userId, runId, itemIds: [] });
    await attachKit({ userId: other, runId: theirs, itemIds: [] });

    await deleteRuns(core(), userId, [runId], quiet, nothingToPurge);

    expect(await copyOf(runId)).toBeUndefined();
    expect(await copyOf(theirs)).toBeDefined();
  });
});
