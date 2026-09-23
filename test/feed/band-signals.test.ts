import { beforeEach, describe, expect, it } from "vitest";
import { drizzle } from "drizzle-orm/d1";

import { entryTags } from "../../src/db/schema-core";
import { env } from "../../src/env";
import { bandSignals, bandSignalsForEntry } from "../../src/modules/feed/band-signals";
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
 * What A3's generated chips are chosen from (design round 20): each kit
 * garment's verdict record in the run's band, and this runner's tag use
 * there. Over real D1, because the walk crosses two databases and the tag
 * and garment reads are chunked under D1's parameter cap.
 */

/**
 * A one-hour run judges at its own feels-like, so 7°C lands every verdict
 * in the 5–10° band, and 20°C in the 20–25° band.
 */
const IN_BAND = 7;
const BAND = 5;

async function tag(entryId: string, ...tags: string[]): Promise<void> {
  await drizzle(env.DIALED_CORE)
    .insert(entryTags)
    .values(tags.map((value) => ({ entryId, tag: value })));
}

/**
A run at its own place, observed at `feelsLikeC`.
*/
async function runAt(userId: string, lat: number, feelsLikeC: number): Promise<string> {
  const runId = await makeRun({ userId, lat, lng: -87.6 });
  await makeObservation({ lat, lng: -87.6, startedAt: NOW, tempC: feelsLikeC, feelsLikeC });
  return runId;
}

beforeEach(async () => {
  await resetTables();
});

describe("bandSignals", () => {
  it("folds each garment's record by verdict sign, over this band only", async () => {
    const userId = await makeUser();
    const shell = await makeItem({ userId, name: "Shell" });
    const gloves = await makeItem({ userId, name: "Gloves" });
    const cap = await makeItem({ userId, name: "Cap" });

    await makeEntry({ userId, runId: await runAt(userId, 41.1, IN_BAND), verdict: -1, itemIds: [shell, gloves] });
    await makeEntry({ userId, runId: await runAt(userId, 41.2, IN_BAND), verdict: 0, itemIds: [shell] });
    await makeEntry({ userId, runId: await runAt(userId, 41.3, IN_BAND), verdict: 2, itemIds: [gloves] });
    // Another band, and an unrated run — neither is this band's record.
    await makeEntry({ userId, runId: await runAt(userId, 41.4, 20), verdict: -2, itemIds: [shell] });
    await makeEntry({ userId, runId: await runAt(userId, 41.5, IN_BAND), itemIds: [shell] });

    const signals = await bandSignals(userId, BAND, [shell, gloves, cap]);

    expect(signals.garments[shell]).toEqual({ total: 2, dialed: 1, colder: 1, warmer: 0 });
    expect(signals.garments[gloves]).toEqual({ total: 2, dialed: 0, colder: 1, warmer: 1 });
    // Never worn here is a record of nothing, not a missing garment — the
    // chip rules need to tell the two apart.
    expect(signals.garments[cap]).toEqual({ total: 0, dialed: 0, colder: 0, warmer: 0 });
  });

  it("counts this runner's tag use in the band, once per entry that used it", async () => {
    const userId = await makeUser();
    const first = await makeEntry({ userId, runId: await runAt(userId, 42.1, IN_BAND), verdict: -1 });
    const second = await makeEntry({ userId, runId: await runAt(userId, 42.2, IN_BAND), verdict: 0 });
    const elsewhere = await makeEntry({ userId, runId: await runAt(userId, 42.3, 20), verdict: 0 });
    await tag(first, "chafed");
    await tag(second, "chafed", "perfect_warmup");
    await tag(elsewhere, "chafed", "hands_cold");

    const signals = await bandSignals(userId, BAND, []);

    expect(signals.tagUse).toEqual({ chafed: 2, perfect_warmup: 1 });
  });

  it("leaves the entry being judged out of its own record", async () => {
    const userId = await makeUser();
    const shell = await makeItem({ userId, name: "Shell" });
    const mine = await makeEntry({ userId, runId: await runAt(userId, 43.1, IN_BAND), verdict: 1, itemIds: [shell] });
    await makeEntry({ userId, runId: await runAt(userId, 43.2, IN_BAND), verdict: 0, itemIds: [shell] });
    await tag(mine, "chafed");

    const signals = await bandSignals(userId, BAND, [shell], mine);

    expect(signals.garments[shell]).toEqual({ total: 1, dialed: 1, colder: 0, warmer: 0 });
    expect(signals.tagUse).toEqual({});
  });

  it("reads another runner's history as nobody's", async () => {
    const userId = await makeUser();
    const other = await makeUser();
    const shell = await makeItem({ userId: other, name: "Shell" });
    const theirs = await makeEntry({ userId: other, runId: await runAt(other, 44.1, IN_BAND), verdict: 0, itemIds: [shell] });
    await tag(theirs, "chafed");

    const signals = await bandSignals(userId, BAND, [shell]);

    expect(signals.garments[shell]?.total).toBe(0);
    expect(signals.tagUse).toEqual({});
  });

  it("reads a band too long for one statement, across chunks", async () => {
    // D1 caps bound parameters per statement; the reads are chunked at 80.
    // Ninety entries cross the boundary, so a wrong chunk step or bound
    // loses or double-counts the second chunk.
    const userId = await makeUser();
    const shell = await makeItem({ userId, name: "Shell" });
    // One place and hour: one observation serves every run.
    await makeObservation({ lat: 45.1, lng: -87.6, startedAt: NOW, tempC: IN_BAND, feelsLikeC: IN_BAND });
    for (let index = 0; index < 90; index += 1) {
      const runId = await makeRun({ userId, lat: 45.1, lng: -87.6 });
      const entryId = await makeEntry({ userId, runId, verdict: 0, itemIds: [shell], createdAt: NOW + index });
      await tag(entryId, "chafed");
    }

    const signals = await bandSignals(userId, BAND, [shell]);

    expect(signals.garments[shell]).toEqual({ total: 90, dialed: 90, colder: 0, warmer: 0 });
    expect(signals.tagUse).toEqual({ chafed: 90 });
  });
});

describe("bandSignalsForEntry", () => {
  it("reads the entry's own kit, and leaves the entry out of its record", async () => {
    const userId = await makeUser();
    const shell = await makeItem({ userId, name: "Shell" });
    const cap = await makeItem({ userId, name: "Cap" });
    const unworn = await makeItem({ userId, name: "Not in this kit" });
    const mine = await makeEntry({ userId, runId: await runAt(userId, 46.1, IN_BAND), verdict: 1, itemIds: [shell, cap] });
    await makeEntry({ userId, runId: await runAt(userId, 46.2, IN_BAND), verdict: -1, itemIds: [shell, unworn] });
    await tag(mine, "chafed");

    const signals = await bandSignalsForEntry(userId, mine, BAND);

    // The kit, and only the kit: a garment the runner owns but did not
    // wear on this run is not a candidate for a chip on it.
    expect(signals.garments).toEqual({
      [shell]: { total: 1, dialed: 0, colder: 1, warmer: 0 },
      [cap]: { total: 0, dialed: 0, colder: 0, warmer: 0 },
    });
    expect(signals.tagUse).toEqual({});
  });

  it("reads someone else's entry as a kit of nothing", async () => {
    const userId = await makeUser();
    const other = await makeUser();
    const shell = await makeItem({ userId: other, name: "Shell" });
    const theirs = await makeEntry({ userId: other, runId: await runAt(other, 47.1, IN_BAND), verdict: 0, itemIds: [shell] });

    const signals = await bandSignalsForEntry(userId, theirs, BAND);

    expect(signals.garments).toEqual({});
  });
});
