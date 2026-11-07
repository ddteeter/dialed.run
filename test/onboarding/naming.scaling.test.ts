import { drizzle } from "drizzle-orm/d1";
import { describe, expect, it } from "vitest";

import { env } from "../../src/env";
import { namingOffer } from "../../src/modules/onboarding/naming";
import { queryCounts } from "../d1-spy";
import { makeEntry, makeItem, makeRun, makeUser } from "../feed/helpers";

/**
 * P2.5's offer costs the same statements for one generic garment as for
 * twenty-five (design 182, part 1). It is the closet's `listItems`, so
 * two: the garments and the runner's history. A closet with nothing
 * linked sends no product-defaults read at all (no ids, no chunks).
 */

function coreDb() {
  return drizzle(env.DIALED_CORE);
}

/**
`count` generic garments, each worn on a run.
*/
async function genericCloset(count: number): Promise<string> {
  const userId = await makeUser();
  for (let index = 0; index < count; index += 1) {
    const itemId = await makeItem({ userId, name: `Piece ${String(index)}` });
    const runId = await makeRun({ userId });
    await makeEntry({ userId, runId, itemIds: [itemId] });
  }
  return userId;
}

describe("namingOffer", () => {
  it("offers 1 and 25 generic garments in the same statements", async () => {
    const small = await genericCloset(1);
    let offered = 0;
    const one = await queryCounts(async () => {
      const result = await namingOffer(coreDb(), small);
      offered = result.items.length;
    });
    expect(offered).toBe(1);

    const large = await genericCloset(25);
    const twentyFive = await queryCounts(async () => {
      const result = await namingOffer(coreDb(), large);
      offered = result.items.length;
    });
    expect(offered).toBe(25);

    expect(one.core).toBe(2);
    expect(twentyFive.core).toBe(one.core);
    expect(twentyFive.weather).toBe(one.weather);
    expect(twentyFive.coreRowsRead).toBeGreaterThan(one.coreRowsRead);
  });
});
