import { drizzle } from "drizzle-orm/d1";
import { beforeEach, describe, expect, it } from "vitest";

import { env } from "../../src/env";
import { newUlid } from "../../src/lib/ids";
import {
  garmentBandCount,
  garmentBandsInput,
} from "../../src/modules/feed/garment-bands";
import {
  makeEntry,
  makeItem,
  makeManualBand,
  makeRun,
  makeUser,
  resetTables,
} from "../feed/helpers";

/**
 * Round 26 #3's "Its record in {b} bands": how many 5 °C bands a piece has
 * a verdicted run in, for the runner who owns it.
 */

function core() {
  return drizzle(env.DIALED_CORE);
}

/**
A verdicted run in this piece, in a band the runner set.
*/
async function wornAt(
  userId: string,
  itemIds: string[],
  tempC: number,
  verdict: number | undefined = 0,
): Promise<string> {
  const runId = await makeRun({ userId });
  await makeManualBand(runId, tempC);
  return makeEntry({ userId, runId, verdict, itemIds });
}

beforeEach(async () => {
  await resetTables();
});

describe("garmentBandCount", () => {
  it("counts the distinct bands the piece's verdicted runs fall in", async () => {
    const userId = await makeUser();
    const itemId = await makeItem({ userId });
    // 6° and 9° share the 5–10° band; 12° is the next one up.
    await wornAt(userId, [itemId], 6);
    await wornAt(userId, [itemId], 9, -1);
    await wornAt(userId, [itemId], 12, 2);

    expect(await garmentBandCount(core(), userId, itemId)).toBe(2);
  });

  it("leaves out a run with no verdict yet", async () => {
    const userId = await makeUser();
    const itemId = await makeItem({ userId });
    await wornAt(userId, [itemId], 6);
    const runId = await makeRun({ userId });
    await makeManualBand(runId, 30);
    await makeEntry({ userId, runId, itemIds: [itemId] });

    expect(await garmentBandCount(core(), userId, itemId)).toBe(1);
  });

  it("leaves out a run with no weather, which has no band", async () => {
    const userId = await makeUser();
    const itemId = await makeItem({ userId });
    const runId = await makeRun({ userId });
    await makeEntry({ userId, runId, verdict: 0, itemIds: [itemId] });

    expect(await garmentBandCount(core(), userId, itemId)).toBe(0);
  });

  it("counts only this piece's runs, and only this runner's", async () => {
    const userId = await makeUser();
    const itemId = await makeItem({ userId });
    const other = await makeItem({ userId });
    await wornAt(userId, [itemId], 6);
    await wornAt(userId, [other], 20);
    const stranger = await makeUser();
    await wornAt(stranger, [itemId], 25);

    expect(await garmentBandCount(core(), userId, itemId)).toBe(1);
    expect(await garmentBandCount(core(), stranger, itemId)).toBe(1);
    expect(await garmentBandCount(core(), newUlid(), itemId)).toBe(0);
  });
});

describe("garmentBandsInput", () => {
  it("takes a garment id and nothing else", () => {
    const itemId = newUlid();
    expect(garmentBandsInput.parse({ itemId })).toStrictEqual({ itemId });
    expect(() => garmentBandsInput.parse({ itemId: "nope" })).toThrow();
  });
});
