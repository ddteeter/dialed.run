import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/d1";
import { beforeEach, describe, expect, it } from "vitest";

import { wardrobeItems } from "../../src/db/schema-core";
import { env } from "../../src/env";
import { newUlid } from "../../src/lib/ids";
import { closetNearby } from "../../src/modules/closet/nearby";
import {
  getItemDetailWithPairs,
  listItems,
} from "../../src/modules/closet/service";
import {
  createOrGetBrand,
  createOrGetProduct,
} from "../../src/modules/products/service";
import { queryCounts } from "../d1-spy";
import {
  makeEntry,
  makeItem,
  makeRun,
  makeUser,
  resetTables,
} from "../feed/helpers";

/**
 * The closet's list reads cost the same number of statements for one
 * garment as for twenty-five (design 182, part 1). Rows read may grow;
 * the statement count may not.
 */

function db() {
  return drizzle(env.DIALED_CORE);
}

beforeEach(async () => {
  await resetTables();
});

/**
 * A top linked to its own product (a brand nobody else typed, since
 * `brands` and `products` are shared and never reset), worn on one run.
 */
async function wornLinkedTop(userId: string, createdAt: number) {
  const itemId = await makeItem({ userId, name: `Top ${String(createdAt)}` });
  const brand = await createOrGetBrand(db(), `Scaling ${newUlid()}`);
  const product = await createOrGetProduct(db(), {
    brandId: brand.id,
    name: "Half Zip",
    createdBy: userId,
  });
  await db()
    .update(wardrobeItems)
    .set({ productId: product.id, createdAt })
    .where(eq(wardrobeItems.id, itemId));
  const runId = await makeRun({ userId });
  await makeEntry({ userId, runId, verdict: 0, itemIds: [itemId] });
  return itemId;
}

async function closetOf(garments: number) {
  const userId = await makeUser();
  for (let index = 0; index < garments; index += 1) {
    await wornLinkedTop(userId, 1_757_000_000 + index);
  }
  return userId;
}

describe("listItems", () => {
  it("reads 1 and 25 worn, linked garments in the same statements", async () => {
    // Three: the garments, one chunk of product defaults (IN_LIST_CHUNK
    // = 80 in src/lib/chunked.ts:43, so 25 distinct products are one
    // chunk), and computeUserPerformance's one history scan
    // (src/modules/closet/service.ts:677).
    const small = await closetOf(1);
    let listed = 0;
    const one = await queryCounts(async () => {
      const result = await listItems(db(), small);
      listed = result.items.length;
    });
    expect(listed).toBe(1);

    await resetTables();
    const large = await closetOf(25);
    const twentyFive = await queryCounts(async () => {
      const result = await listItems(db(), large);
      listed = result.items.length;
    });
    expect(listed).toBe(25);

    expect(one.core).toBe(3);
    expect(twentyFive.core).toBe(one.core);
    expect(twentyFive.weather).toBe(one.weather);
    expect(twentyFive.coreRowsRead).toBeGreaterThan(one.coreRowsRead);
  });
});

describe("closetNearby", () => {
  it("reads 1 and 25 garments in the same statements", async () => {
    const small = await closetOf(1);
    let shown = 0;
    const one = await queryCounts(async () => {
      const result = await closetNearby(db(), small);
      shown = result.tops?.length ?? 0;
    });
    expect(shown).toBe(1);

    await resetTables();
    const large = await closetOf(25);
    const twentyFive = await queryCounts(async () => {
      const result = await closetNearby(db(), large);
      shown = result.tops?.length ?? 0;
    });
    // A group lists every piece; the card counts past its five.
    expect(shown).toBe(25);

    expect(twentyFive.core).toBe(one.core);
    expect(twentyFive.weather).toBe(one.weather);
    expect(twentyFive.coreRowsRead).toBeGreaterThan(one.coreRowsRead);
  });
});

/**
 * A linked top worn with a partner on `runs` dialed runs — its history
 * and its "pairs with" both grow with the runs.
 */
async function historyOf(runCount: number) {
  const userId = await makeUser();
  const itemId = await wornLinkedTop(userId, 1_757_000_000);
  const partner = await makeItem({ userId, category: "bottom" });
  // `wornLinkedTop` already logged one run of the top on its own.
  for (let index = 1; index < runCount; index += 1) {
    const runId = await makeRun({ userId });
    await makeEntry({ userId, runId, verdict: 0, itemIds: [itemId, partner] });
  }
  return { userId, itemId };
}

describe("getItemDetailWithPairs", () => {
  it("reads 3 and 25 runs of history in the same statements", async () => {
    // Three, not one, as the small history: under PAIRS_WITH_MIN_RUNS = 3
    // (src/modules/closet/service.ts:657) a piece shows no pairs, so the
    // lookup of their names (getItemsByIds) is skipped altogether. From
    // three runs it is one statement, whatever the history's length.
    const small = await historyOf(3);
    let runCount = 0;
    let paired = 0;
    const three = await queryCounts(async () => {
      const detail = await getItemDetailWithPairs(
        db(),
        small.userId,
        small.itemId,
      );
      runCount = detail.performance?.summary.runCount ?? 0;
      paired = detail.pairedItems.length;
    });
    expect(runCount).toBe(3);
    expect(paired).toBe(1);

    await resetTables();
    const large = await historyOf(25);
    const twentyFive = await queryCounts(async () => {
      const detail = await getItemDetailWithPairs(
        db(),
        large.userId,
        large.itemId,
      );
      runCount = detail.performance?.summary.runCount ?? 0;
      paired = detail.pairedItems.length;
    });
    expect(runCount).toBe(25);
    expect(paired).toBe(1);

    expect(twentyFive.core).toBe(three.core);
    expect(twentyFive.weather).toBe(three.weather);
    expect(twentyFive.coreRowsRead).toBeGreaterThan(three.coreRowsRead);
  });
});
