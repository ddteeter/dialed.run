import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";

import { runs } from "../../src/db/schema-core";
import { coreDb } from "../../src/env";
import { getEntryDetail } from "../../src/modules/feed/entries";
import { followingFeed } from "../../src/modules/feed/feed";
import { listRunSummaries } from "../../src/modules/runs/service";
import { NOW, makeEntry, makeRun, makeUser, resetTables } from "./helpers";

/**
 * Who each read says to credit (design G1): a Garmin run carries its
 * device name, and every other run carries none — `undefined`, so a
 * component's "draw nothing" is the only answer, never a `null` it would
 * have to know about.
 */

beforeEach(async () => {
  await resetTables();
});

async function garminAndFileRuns(): Promise<{
  userId: string;
  garmin: string;
  file: string;
}> {
  const userId = await makeUser();
  const garmin = await makeRun({ userId, startedAt: NOW - 100 });
  const file = await makeRun({ userId, startedAt: NOW - 200 });
  await coreDb()
    .update(runs)
    .set({ source: "garmin", deviceName: "Garmin" })
    .where(eq(runs.id, garmin));
  return { userId, garmin, file };
}

describe("the device a run credits", () => {
  it("is on the runs list's summaries", async () => {
    const { userId, garmin, file } = await garminAndFileRuns();
    const summaries = await listRunSummaries(coreDb(), userId);
    const byId = new Map(summaries.map((run) => [run.id, run.deviceName]));
    expect(byId.get(garmin)).toBe("Garmin");
    expect(byId.has(file)).toBe(true);
    expect(byId.get(file)).toBeUndefined();
  });

  it("is on the entry detail", async () => {
    const { userId, garmin, file } = await garminAndFileRuns();
    const garminEntry = await makeEntry({ userId, runId: garmin });
    const fileEntry = await makeEntry({ userId, runId: file });
    const garminDetail = await getEntryDetail(garminEntry, userId);
    expect(garminDetail?.deviceName).toBe("Garmin");
    const fileDetail = await getEntryDetail(fileEntry, userId);
    expect(fileDetail).toBeDefined();
    expect(fileDetail?.deviceName).toBeUndefined();
  });

  it("is on the feed's cards", async () => {
    const { userId, garmin, file } = await garminAndFileRuns();
    const garminEntry = await makeEntry({ userId, runId: garmin });
    const fileEntry = await makeEntry({
      userId,
      runId: file,
      createdAt: NOW + 1,
    });
    const { items } = await followingFeed(userId);
    const byId = new Map(items.map((item) => [item.entryId, item]));
    expect(byId.get(garminEntry)?.deviceName).toBe("Garmin");
    expect(byId.get(fileEntry)).toBeDefined();
    expect(byId.get(fileEntry)?.deviceName).toBeUndefined();
  });
});
