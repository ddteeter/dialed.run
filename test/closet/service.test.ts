import { drizzle } from "drizzle-orm/d1";
import { describe, expect, it } from "vitest";

import { outfitEntries, outfitEntryItems, runs } from "../../src/db/schema-core";
import { env } from "../../src/env";
import { newUlid } from "../../src/lib/ids";
import {
  createOrGetBrand,
  createOrGetProduct,
} from "../../src/modules/products/service";
import {
  computeUserPerformance,
  createItem,
  deleteOrRetireItem,
  getItemDetail,
  getOwnedItem,
  listItems,
  NotFoundError,
  retireItem,
  updateItem,
} from "../../src/modules/closet/service";
import { addFromTapList } from "../../src/modules/closet/tap-list";

function db() {
  return drizzle(env.DIALED_CORE);
}

/** Inserts a run + a public outfit_entry containing the given items, with
 * the given verdict, and returns the entry id. */
async function logEntry(
  userId: string,
  itemIds: string[],
  verdict: number | null,
  distanceM = 8000,
  createdAt = Math.floor(Date.now() / 1000),
) {
  const client = db();
  const runId = newUlid();
  await client.insert(runs).values({
    id: runId,
    userId,
    source: "manual",
    startedAt: createdAt,
    durationS: 2400,
    distanceM,
    title: "Test run",
  });
  const entryId = newUlid();
  await client.insert(outfitEntries).values({
    id: entryId,
    runId,
    userId,
    verdict,
    isPublic: true,
    createdAt,
  });
  for (const itemId of itemIds) {
    await client.insert(outfitEntryItems).values({ entryId, itemId });
  }
  return entryId;
}

describe("closet CRUD roundtrip", () => {
  it("creates an item, computing an estimated temp range from attributes", async () => {
    const userId = newUlid();
    const item = await createItem(db(), userId, {
      category: "top",
      name: "Harrier",
      brand: "Tracksmith",
      layer: "mid",
      weight: "mid",
    });
    expect(item.category).toBe("top");
    expect(item.estTempLowC).not.toBeNull();
    expect(item.estTempHighC).not.toBeNull();
    expect(item.origin).toBe("manual");
    expect(item.retired).toBe(false);
  });

  it("updates an item, clearing attributes that no longer apply to the new category", async () => {
    const userId = newUlid();
    const created = await createItem(db(), userId, {
      category: "top",
      name: "Jacket",
      layer: "outer",
      weight: "light",
      windResistant: true,
    });
    const updated = await updateItem(db(), userId, created.id, {
      category: "shoes",
      name: "Trail shoe",
      waterResistant: true,
    });
    expect(updated.category).toBe("shoes");
    expect(updated.layer).toBeNull();
    expect(updated.weight).toBeNull();
    expect(updated.windResistant).toBeNull();
    expect(updated.waterResistant).toBe(true);
  });

  it("stores an explicit user-typed temp range as-is", async () => {
    const userId = newUlid();
    const item = await createItem(db(), userId, {
      category: "accessory",
      name: "Buff",
      estTempLowC: -5,
      estTempHighC: 10,
    });
    expect(item.estTempLowC).toBe(-5);
    expect(item.estTempHighC).toBe(10);
  });
});

describe("retire, don't delete", () => {
  it("hard-deletes an item with no outfit_entry_item reference", async () => {
    const userId = newUlid();
    const item = await createItem(db(), userId, {
      category: "accessory",
      name: "Unworn cap",
    });
    const outcome = await deleteOrRetireItem(db(), userId, item.id);
    expect(outcome.action).toBe("deleted");
    await expect(getOwnedItem(db(), userId, item.id)).rejects.toBeInstanceOf(
      NotFoundError,
    );
  });

  it("only retires an item referenced by an outfit_entry_item", async () => {
    const userId = newUlid();
    const item = await createItem(db(), userId, {
      category: "accessory",
      name: "Worn cap",
    });
    await logEntry(userId, [item.id], 0);
    const outcome = await deleteOrRetireItem(db(), userId, item.id);
    expect(outcome.action).toBe("retired");
    const stillThere = await getOwnedItem(db(), userId, item.id);
    expect(stillThere.retired).toBe(true);
  });

  it("retireItem sets the flag directly", async () => {
    const userId = newUlid();
    const item = await createItem(db(), userId, {
      category: "accessory",
      name: "Gloves",
    });
    const retired = await retireItem(db(), userId, item.id);
    expect(retired.retired).toBe(true);
  });
});

describe("cross-user authorization", () => {
  it("denies a different user reading or mutating the item", async () => {
    const owner = newUlid();
    const intruder = newUlid();
    const item = await createItem(db(), owner, {
      category: "top",
      name: "Private shirt",
    });

    await expect(getOwnedItem(db(), intruder, item.id)).rejects.toBeInstanceOf(
      NotFoundError,
    );
    await expect(
      updateItem(db(), intruder, item.id, { category: "top", name: "Hijacked" }),
    ).rejects.toBeInstanceOf(NotFoundError);
    await expect(retireItem(db(), intruder, item.id)).rejects.toBeInstanceOf(
      NotFoundError,
    );
    await expect(
      deleteOrRetireItem(db(), intruder, item.id),
    ).rejects.toBeInstanceOf(NotFoundError);

    // Untouched by the denied calls.
    const stillOwned = await getOwnedItem(db(), owner, item.id);
    expect(stillOwned.name).toBe("Private shirt");
  });
});

describe("product-linked defaults and generic detection", () => {
  it("marks a product-linked item non-generic and a bare item generic", async () => {
    const userId = newUlid();
    const client = db();
    const brand = await createOrGetBrand(client, "Test Brand");
    const product = await createOrGetProduct(client, {
      brandId: brand.id,
      name: "Test Product",
      createdBy: userId,
    });
    const linked = await createItem(client, userId, {
      category: "top",
      name: "Test Product",
      productId: product.id,
    });
    const generic = await createItem(client, userId, {
      category: "top",
      name: "Some long sleeve",
    });

    const detailLinked = await getItemDetail(client, userId, linked.id);
    const detailGeneric = await getItemDetail(client, userId, generic.id);
    expect(detailLinked.isGeneric).toBe(false);
    expect(detailGeneric.isGeneric).toBe(true);
  });
});

describe("listItems filters and the generic nudge", () => {
  it("counts generic vs total and filters by category", async () => {
    const userId = newUlid();
    const client = db();
    await createItem(client, userId, { category: "top", name: "Top A" });
    await createItem(client, userId, { category: "bottom", name: "Bottom A" });

    const all = await listItems(client, userId);
    expect(all.totalCount).toBe(2);
    expect(all.genericCount).toBe(2);

    const tops = await listItems(client, userId, { category: "top" });
    expect(tops.items).toHaveLength(1);
    expect(tops.items[0]?.item.name).toBe("Top A");
  });

  it("excludes retired items by default and includes them when asked", async () => {
    const userId = newUlid();
    const client = db();
    const item = await createItem(client, userId, {
      category: "top",
      name: "To retire",
    });
    await retireItem(client, userId, item.id);

    const excluding = await listItems(client, userId);
    expect(excluding.items).toHaveLength(0);

    const including = await listItems(client, userId, { includeRetired: true });
    expect(including.items).toHaveLength(1);
  });

  it("groups a jacket (top + outer layer) into the Outer UI group", async () => {
    const userId = newUlid();
    const client = db();
    await createItem(client, userId, {
      category: "top",
      name: "Shell",
      layer: "outer",
      weight: "light",
    });
    const listing = await listItems(client, userId);
    expect(listing.items[0]?.uiGroup).toBe("outer");
  });
});

describe("performance stats: verdicts, mileage, pairs-with", () => {
  it("computes verdict counts, dialed ratio, mileage, and top pairs", async () => {
    const userId = newUlid();
    const client = db();
    const shirt = await createItem(client, userId, {
      category: "top",
      name: "Shirt",
    });
    const shorts = await createItem(client, userId, {
      category: "bottom",
      name: "Shorts",
    });
    const rareItem = await createItem(client, userId, {
      category: "accessory",
      name: "Rarely paired",
    });

    await logEntry(userId, [shirt.id, shorts.id], 0, 5000);
    await logEntry(userId, [shirt.id, shorts.id], 0, 7000);
    await logEntry(userId, [shirt.id, shorts.id], 0, 3000);
    await logEntry(userId, [shirt.id, rareItem.id], -1, 1000);

    const performance = await computeUserPerformance(client, userId);
    const shirtStats = performance.get(shirt.id);
    expect(shirtStats?.summary.verdictCount).toBe(4);
    expect(shirtStats?.summary.dialedCount).toBe(3);
    expect(shirtStats?.summary.mileageM).toBe(16_000);
    expect(shirtStats?.buckets).toContain("most_dialed");
    expect(shirtStats?.pairsWith).toContain(shorts.id);
  });

  it("classifies an item with verdicts but never dialed as never_worked", async () => {
    const userId = newUlid();
    const client = db();
    const item = await createItem(client, userId, {
      category: "gloves",
      name: "Wrong gloves",
    });
    await logEntry(userId, [item.id], -2);
    await logEntry(userId, [item.id], 1);

    const performance = await computeUserPerformance(client, userId);
    expect(performance.get(item.id)?.buckets).toContain("never_worked");
  });

  it("classifies an item with no verdicts as untested via the closet listing", async () => {
    const userId = newUlid();
    const client = db();
    await createItem(client, userId, { category: "socks", name: "New socks" });

    const listing = await listItems(client, userId, { performance: "untested" });
    expect(listing.items).toHaveLength(1);
  });
});

describe("tap-list", () => {
  it("creates origin='taplist' rows for the selected keys", async () => {
    const userId = newUlid();
    const created = await addFromTapList(db(), userId, {
      band: "mild",
      keys: ["mild-tee", "mild-shorts"],
    });
    expect(created).toHaveLength(2);
    for (const item of created) {
      expect(item.origin).toBe("taplist");
    }
  });

  it("skips unknown keys rather than failing the whole batch", async () => {
    const userId = newUlid();
    const created = await addFromTapList(db(), userId, {
      band: "cold",
      keys: ["cold-beanie", "not-a-real-key"],
    });
    expect(created).toHaveLength(1);
  });
});
