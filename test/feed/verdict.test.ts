import { beforeEach, describe, expect, it } from "vitest";

import {
  attachKit,
  itemBandWearStat,
  recordVerdictPrompted,
  shouldPromptForVerdict,
  submitVerdict,
  verdictBandCounts,
} from "../../src/modules/feed/entries";
import { makeItem, makeObservation, makeRun, makeUser, resetTables } from "./helpers";

describe("verdict flow (A3)", () => {
  beforeEach(resetTables);

  it("saves an entry with a null verdict when the kit is attached", async () => {
    const userId = await makeUser();
    const runId = await makeRun({ userId });
    const entryId = await attachKit({ userId, runId, itemIds: [] });

    expect(await shouldPromptForVerdict(userId, entryId)).toBe(true);
  });

  it("prompts once for a missing verdict, then never again", async () => {
    const userId = await makeUser();
    const runId = await makeRun({ userId });
    const entryId = await attachKit({ userId, runId, itemIds: [] });

    expect(await shouldPromptForVerdict(userId, entryId)).toBe(true);
    await recordVerdictPrompted(userId, entryId);
    expect(await shouldPromptForVerdict(userId, entryId)).toBe(false);

    // Idempotent — calling it again (e.g. a retried request) doesn't error
    // and the prompt still never reappears.
    await recordVerdictPrompted(userId, entryId);
    expect(await shouldPromptForVerdict(userId, entryId)).toBe(false);
  });

  it("stops prompting once the entry actually gets a verdict", async () => {
    const userId = await makeUser();
    const runId = await makeRun({ userId });
    const entryId = await attachKit({ userId, runId, itemIds: [] });

    await submitVerdict({
      userId,
      entryId,
      verdict: 0,
      isPublic: true,
      tags: [],
      itemFlags: [],
    });

    expect(await shouldPromptForVerdict(userId, entryId)).toBe(false);
  });

  it("shows the user's own verdict distribution within the run's temperature band", async () => {
    const userId = await makeUser();
    const lat = 5;
    const lng = 5;
    const startedAt = 1_757_000_000;

    const bandStartedAt = (offsetHours: number) => startedAt + offsetHours * 3600;
    const makeVerdictedEntry = async (verdict: number, offsetHours: number) => {
      const at = bandStartedAt(offsetHours);
      const runId = await makeRun({ userId, lat, lng, startedAt: at });
      await makeObservation({ lat, lng, startedAt: at, tempC: 6, feelsLikeC: 6 });
      const entryId = await attachKit({ userId, runId, itemIds: [] });
      await submitVerdict({ userId, entryId, verdict, isPublic: true, tags: [], itemFlags: [] });
    };

    await makeVerdictedEntry(0, 0);
    await makeVerdictedEntry(0, 1);
    await makeVerdictedEntry(-1, 2);

    const counts = await verdictBandCounts(userId, 5); // bandFloorC(6) === 5
    expect(counts[0]).toBe(2);
    expect(counts[-1]).toBe(1);
    expect(counts[1]).toBe(0);
  });

  it("reports how often an item was worn within its band, out of entries logged there", async () => {
    const userId = await makeUser();
    const lat = 15;
    const lng = 15;
    const item = await makeItem({ userId });
    const other = await makeItem({ userId, name: "Other garment" });

    const wear = async (itemIds: string[], offsetHours: number) => {
      const at = 1_757_100_000 + offsetHours * 3600;
      const runId = await makeRun({ userId, lat, lng, startedAt: at });
      await makeObservation({ lat, lng, startedAt: at, tempC: 6, feelsLikeC: 6 });
      await attachKit({ userId, runId, itemIds });
    };

    await wear([item], 0);
    await wear([item], 1);
    await wear([other], 2);

    const stat = await itemBandWearStat(userId, item, 5);
    expect(stat).toEqual({ worn: 2, total: 3 });
  });
});
