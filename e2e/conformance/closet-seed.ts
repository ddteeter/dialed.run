import { eq, inArray } from "drizzle-orm";

import {
  brands,
  outfitEntries,
  outfitEntryItems,
  products,
  runs,
  wardrobeItems,
} from "../../src/db/schema-core";
import { newUlid } from "../../src/lib/ids";
import { nowSeconds } from "../../src/lib/now";
import { withLocalDb } from "../support/local-db";
import { userIdOf } from "./logging-fixtures";

/**
The closet demo account's user id — every closet conformance spec uses it.
*/
export async function closetUserId(): Promise<string> {
  return userIdOf("closet");
}

/**
What `seedRoundTwentyTwoGarment` wrote, so the spec can take it back out.
*/
export interface SeededGarment {
  itemId: string;
  itemIds: readonly string[];
  productId: string;
  brandId: string;
  runIds: readonly string[];
  entryIds: readonly string[];
}

/**
 * Round 22's "Y Garment detail", as rows: the Janji Rover Half-zip, size
 * M, colourway Midnight with its exact shade, working at 38–46°, worn on
 * 14 runs totalling 142 km with 9 of them dialed — six of those with the
 * Bandit 5" Split and four with the thin gloves.
 *
 * **The board's data, not ours**, because the harness compares words and
 * the words of a garment are its data. Seeded rather than asserted from
 * memory, so a cell that differs is a composition difference and not a
 * fixture that drifted.
 *
 * The photo key points at nothing in R2: the frame's photo is a hatch,
 * and what is compared is the box the photo sits in, not its pixels.
 */
export async function seedRoundTwentyTwoGarment(
  userId: string,
): Promise<SeededGarment> {
  const createdAt = nowSeconds() - 86_400;
  const itemId = newUlid();
  const splitId = newUlid();
  const glovesId = newUlid();
  // A named piece: the frame's heading is "Janji Rover Half-zip", which
  // is the brand and the model together — a garment linked to a product.
  // The brand row's key is unique per run so no earlier run collides.
  const brandId = newUlid();
  const productId = newUlid();
  const runIds: string[] = [];
  const entryIds: string[] = [];

  await withLocalDb(async ({ core }) => {
    await core.insert(brands).values({
      id: brandId,
      name: "Janji",
      normalized: `conformance ${brandId}`,
    });
    await core.insert(products).values({
      id: productId,
      brandId,
      name: "Rover Half-zip",
      normalizedName: "rover half-zip",
      createdBy: userId,
      createdAt,
    });
    await core.insert(wardrobeItems).values([
      {
        id: itemId,
        userId,
        category: "top",
        brand: "Janji",
        name: "Rover Half-zip",
        size: "M",
        // So composition has something to say: the frame draws the region.
        weight: "mid",
        color: "Midnight",
        colorHex: "#1f2a44",
        estTempLowC: 38,
        estTempHighC: 46,
        photoKey: `items/${userId}/${itemId}`,
        productId,
        createdAt,
      },
      {
        id: splitId,
        userId,
        category: "bottom",
        name: 'Bandit 5" Split',
        createdAt,
      },
      {
        id: glovesId,
        userId,
        category: "gloves",
        name: "Thin gloves",
        createdAt,
      },
    ]);

    for (let index = 0; index < 14; index += 1) {
      const runId = newUlid();
      const entryId = newUlid();
      runIds.push(runId);
      entryIds.push(entryId);
      // Thirteen runs of 10 km and one of 12: 142 km.
      const distanceM = index === 0 ? 12_000 : 10_000;
      await core.insert(runs).values({
        id: runId,
        userId,
        title: "Conformance",
        startedAt: createdAt - index * 86_400,
        durationS: 3000,
        distanceM,
        source: "manual",
        indoor: false,
        weatherStatus: "attached",
      });
      // The first nine dialed, the rest a little cold.
      await core.insert(outfitEntries).values({
        id: entryId,
        userId,
        runId,
        verdict: index < 9 ? 0 : -1,
        isPublic: false,
        createdAt: createdAt - index * 86_400,
      });
      const kit = [itemId];
      if (index < 6) kit.push(splitId);
      if (index < 4) kit.push(glovesId);
      await core
        .insert(outfitEntryItems)
        .values(kit.map((id) => ({ entryId, itemId: id })));
    }
  });

  return {
    itemId,
    itemIds: [itemId, splitId, glovesId],
    productId,
    brandId,
    runIds,
    entryIds,
  };
}

export async function removeSeededGarment(seed: SeededGarment): Promise<void> {
  await withLocalDb(async ({ core }) => {
    await core
      .delete(outfitEntryItems)
      .where(inArray(outfitEntryItems.entryId, [...seed.entryIds]));
    await core
      .delete(outfitEntries)
      .where(inArray(outfitEntries.id, [...seed.entryIds]));
    await core.delete(runs).where(inArray(runs.id, [...seed.runIds]));
    await core
      .delete(wardrobeItems)
      .where(inArray(wardrobeItems.id, [...seed.itemIds]));
    await core.delete(products).where(eq(products.id, seed.productId));
    await core.delete(brands).where(eq(brands.id, seed.brandId));
  });
}
