import { beforeEach, describe, expect, it } from "vitest";

import { coverageLadder } from "../../src/modules/feed";
import {
  NOW,
  makeEntry,
  makeItem,
  makeObservation,
  makeRun,
  makeUser,
  resetTables,
} from "./helpers";

/**
 * The ladder's read. What matters here and not in `ladder.test.ts` is the
 * **gaps**: a band a runner has skipped over must come back as an empty
 * band, because the Call tab exists to ask for it.
 */
beforeEach(async () => {
  await resetTables();
});

async function verdictAt(
  userId: string,
  item: string,
  feelsLikeC: number,
  verdict: number,
  seq: number,
): Promise<void> {
  // A distinct place per entry, so each lands on its own observation.
  const lat = 30 + seq / 100;
  const lng = 30 + seq / 100;
  const runId = await makeRun({ userId, lat, lng, startedAt: NOW });
  await makeObservation({ lat, lng, startedAt: NOW, tempC: feelsLikeC, feelsLikeC });
  await makeEntry({
    userId,
    runId,
    isPublic: true,
    createdAt: NOW + seq,
    itemIds: [item],
    verdict,
  });
}

describe("coverageLadder", () => {
  it("answers with nothing for a runner who has logged nothing", async () => {
    expect(await coverageLadder(await makeUser())).toStrictEqual([]);
  });

  it("renders the gap between two logged bands as an empty band", async () => {
    // 2°C lands in the 0 band and 12°C in the 10 band. The 5 band is a gap
    // the runner runs through and has never rated — the ask.
    const userId = await makeUser();
    const item = await makeItem({ userId, category: "top" });
    await verdictAt(userId, item, 2, 0, 1);
    await verdictAt(userId, item, 12, 0, 2);

    const bands = await coverageLadder(userId);

    expect(bands.map((band) => band.bandFloorC)).toStrictEqual([0, 5, 10]);
    const gap = bands.find((band) => band.bandFloorC === 5);
    expect(gap).toMatchObject({ cold: 0, dialed: 0, warm: 0 });
    // A gap is a row a runner reads, so it is labelled like any other.
    expect(gap?.label).toBe("41–50°");
  });

  it("counts each verdict into the band its verdict was about", async () => {
    const userId = await makeUser();
    const item = await makeItem({ userId, category: "top" });
    await verdictAt(userId, item, 2, -1, 1);
    await verdictAt(userId, item, 3, 0, 2);

    const [band] = await coverageLadder(userId);

    expect(band).toMatchObject({ bandFloorC: 0, cold: 1, dialed: 1, warm: 0 });
    // The band carries its label in the reader's own unit — 0-5C is
    // 32-41F, and a band with no label is a row with nothing to read.
    expect(band?.label).toBe("32–41°");
  });

  it("leaves an unrated entry out of the ladder entirely", async () => {
    // The ladder measures what the app has been told. An unrated run has
    // told it nothing, so it must not make a band look covered.
    const userId = await makeUser();
    const item = await makeItem({ userId, category: "top" });
    const lat = 40;
    const lng = 40;
    const runId = await makeRun({ userId, lat, lng, startedAt: NOW });
    await makeObservation({ lat, lng, startedAt: NOW, tempC: 2, feelsLikeC: 2 });
    await makeEntry({ userId, runId, createdAt: NOW, itemIds: [item] });

    expect(await coverageLadder(userId)).toStrictEqual([]);
  });

  it("keeps one runner's ladder to their own entries", async () => {
    const mine = await makeUser();
    const theirs = await makeUser();
    const item = await makeItem({ userId: theirs, category: "top" });
    await verdictAt(theirs, item, 2, 0, 1);

    expect(await coverageLadder(mine)).toStrictEqual([]);
  });
});
