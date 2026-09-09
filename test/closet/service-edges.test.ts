import { drizzle } from "drizzle-orm/d1";
import { describe, expect, it } from "vitest";
import { z } from "zod";

import { env } from "../../src/env";
import { newUlid } from "../../src/lib/ids";
import { createOrGetBrand, createOrGetProduct } from "../../src/modules/products/service";
import {
  outfitEntries,
  outfitEntryItems,
  products,
  runs,
  wardrobeItems,
} from "../../src/db/schema-core";
import { eq } from "drizzle-orm";
import {
  computeUserPerformance,
  createItem,
  effectiveTempRange,
  getItemDetail,
  getItemsByIds,
  getOwnedItem,
  listItems,
  retireItem,
  unretireItem,
  withResolvedProduct,
} from "../../src/modules/closet/service";

/**
 * The closet service's remaining edges: product resolution on save, the
 * stored-versus-estimated temperature range, and the reads that answer with
 * nothing.
 *
 * `withResolvedProduct` arrived with the forms PR and had no coverage at
 * all — twenty-eight mutants in the one function that decides whether a
 * garment a runner typed becomes a link to a shared canonical product.
 */

/**
The nullable column's empty value, parsed rather than written as a literal.
*/
function sqlNull(): number | null {
  return z.null().parse(JSON.parse("null"));
}

function db() {
  return drizzle(env.DIALED_CORE);
}

describe("withResolvedProduct", () => {
  it("links a garment that names both a brand and a product", async () => {
    const userId = newUlid();
    const resolved = await withResolvedProduct(
      db(),
      { category: "top", name: "Rover Half-Zip", brand: "Janji" },
      userId,
    );
    expect(resolved.productId).toBeDefined();
    expect(resolved.name).toBe("Rover Half-Zip");
  });

  it("leaves a garment with no brand generic", async () => {
    // A generic piece is the whole point of the tap list and of D-27's
    // upgrade path: no brand means no product to share.
    const resolved = await withResolvedProduct(
      db(),
      { category: "top", name: "Long sleeve base layer" },
      newUlid(),
    );
    expect(resolved.productId).toBeUndefined();
  });

  it("treats a brand of only spaces as no brand", async () => {
    const resolved = await withResolvedProduct(
      db(),
      { category: "top", name: "Wind jacket", brand: " ".repeat(3) },
      newUlid(),
    );
    expect(resolved.productId).toBeUndefined();
  });

  it("treats a name of only spaces as nothing to resolve", async () => {
    // Both halves of the identity are required, and either one missing
    // stops the resolution rather than creating a product called " ".
    const resolved = await withResolvedProduct(
      db(),
      { category: "top", name: " ".repeat(3), brand: "Janji" },
      newUlid(),
    );
    expect(resolved.productId).toBeUndefined();
    expect(resolved.name).toBe(" ".repeat(3));
  });

  it("sends two runners typing the same thing to one product row", async () => {
    const first = await withResolvedProduct(
      db(),
      { category: "top", name: "Shared Half-Zip", brand: "Sharedbrand" },
      newUlid(),
    );
    const second = await withResolvedProduct(
      db(),
      { category: "top", name: "shared  half-zip", brand: "sharedbrand" },
      newUlid(),
    );
    expect(second.productId).toBe(first.productId);
  });

  it("inherits the product's type when the category admits it", async () => {
    // Type is the product's property, not the garment's — this is the one
    // place a garment gets one without the runner choosing it.
    const client = db();
    const brand = await createOrGetBrand(client, "Typed Brand");
    const product = await createOrGetProduct(client, {
      brandId: brand.id,
      name: "Typed Half-Zip",
      createdBy: newUlid(),
    });
    await client
      .update(products)
      .set({ type: "halfZip" })
      .where(eq(products.id, product.id));

    const resolved = await withResolvedProduct(
      client,
      { category: "top", name: "Typed Half-Zip", brand: "Typed Brand" },
      newUlid(),
    );

    expect(resolved.type).toBe("halfZip");
  });

  it("refuses a product type its category does not admit", async () => {
    // Shoes are not half-zips. A product row mistyped by enrichment must
    // not put an impossible type on a garment.
    const client = db();
    const brand = await createOrGetBrand(client, "Mismatch Brand");
    const product = await createOrGetProduct(client, {
      brandId: brand.id,
      name: "Mismatch Shoe",
      createdBy: newUlid(),
    });
    await client
      .update(products)
      .set({ type: "halfZip" })
      .where(eq(products.id, product.id));

    const resolved = await withResolvedProduct(
      client,
      { category: "shoes", name: "Mismatch Shoe", brand: "Mismatch Brand" },
      newUlid(),
    );

    // Absent, not present-and-undefined: the spread that adds it is
    // conditional, and a garment carrying `type: undefined` is a different
    // row shape from one that never had a type.
    expect(Object.hasOwn(resolved, "type")).toBe(false);
    expect(resolved.productId).toBe(product.id);
  });

  it("leaves a product with no type alone", async () => {
    const resolved = await withResolvedProduct(
      db(),
      { category: "top", name: "Untyped Half-Zip", brand: "Untyped Brand" },
      newUlid(),
    );
    expect(Object.hasOwn(resolved, "type")).toBe(false);
  });
});

describe("effectiveTempRange", () => {
  it("uses the stored range when the item has one", async () => {
    const item = await createItem(
      db(),
      newUlid(),
      {
        category: "top",
        name: "Stored range shirt",
        estTempLowC: -3,
        estTempHighC: 7,
      },
      "manual",
    );

    expect(
      effectiveTempRange(item, {
        weight: undefined,
        fabric: undefined,
        windResistant: undefined,
        waterResistant: undefined,
      }),
    ).toStrictEqual({ lowC: -3, highC: 7 });
  });

  it("estimates from the attributes when the item has no stored range", async () => {
    // The estimate is what a filter matches against for the great majority
    // of items, since almost nobody types a temperature range.
    const item = await createItem(
      db(),
      newUlid(),
      { category: "top", name: "Estimated shirt", layer: "mid" },
      "manual",
    );

    const range = effectiveTempRange(item, {
      weight: "mid",
      fabric: undefined,
      windResistant: undefined,
      waterResistant: undefined,
    });

    // A number, not the absence of one: skipping the guard would hand back
    // the item's two empty columns as if they were a range, and every
    // temperature filter would then compare against nothing.
    expect(typeof range?.lowC).toBe("number");
    expect(typeof range?.highC).toBe("number");
  });

  it("estimates from the item's own layer, not from nothing", async () => {
    // The layer is on the item row and the weight comes from the merge, so
    // the estimate reads from two places. Dropping either changes the
    // range a filter matches against.
    const attributes = {
      weight: "mid",
      fabric: undefined,
      windResistant: undefined,
      waterResistant: undefined,
    } as const;
    const base = await createItem(
      db(),
      newUlid(),
      { category: "top", name: "Base layer shirt", layer: "base" },
      "manual",
    );
    const outer = await createItem(
      db(),
      newUlid(),
      { category: "top", name: "Outer layer shirt", layer: "outer" },
      "manual",
    );

    expect(effectiveTempRange(base, attributes)).not.toStrictEqual(
      effectiveTempRange(outer, attributes),
    );
  });

  it("prefers the effective weight over the item's own empty column", async () => {
    // A garment with no weight of its own inherits the product's, and the
    // estimate has to use the inherited one or the filter disagrees with
    // the detail page.
    const item = await createItem(
      db(),
      newUlid(),
      { category: "top", name: "Inherited weight shirt" },
      "manual",
    );

    const light = effectiveTempRange(item, {
      weight: "light",
      fabric: undefined,
      windResistant: undefined,
      waterResistant: undefined,
    });
    const heavy = effectiveTempRange(item, {
      weight: "heavy",
      fabric: undefined,
      windResistant: undefined,
      waterResistant: undefined,
    });

    expect(light).not.toStrictEqual(heavy);
  });
});

describe("reads that answer with nothing", () => {
  it("asks the database nothing for an empty id list", async () => {
    expect(await getItemsByIds(db(), newUlid(), [])).toStrictEqual([]);
  });

  it("answers only about the caller's own items", async () => {
    const client = db();
    const mine = newUlid();
    const theirs = newUlid();
    const myItem = await createItem(
      client,
      mine,
      { category: "top", name: "Mine" },
      "manual",
    );
    const theirItem = await createItem(
      client,
      theirs,
      { category: "top", name: "Theirs" },
      "manual",
    );

    const rows = await getItemsByIds(client, mine, [myItem.id, theirItem.id]);

    expect(rows.map((row) => row.id)).toStrictEqual([myItem.id]);
  });
});

describe("retiring and bringing back", () => {
  it("puts a retired item back on the shelf", async () => {
    // `retired: false` and not merely "some update": the mutant that flips
    // it retires the item again, and the button reads "unretire".
    const client = db();
    const userId = newUlid();
    const item = await createItem(
      client,
      userId,
      { category: "top", name: "Comeback shirt" },
      "manual",
    );
    await retireItem(client, userId, item.id);
    const retired = await getOwnedItem(client, userId, item.id);
    expect(retired.retired).toBe(true);

    await unretireItem(client, userId, item.id);

    const back = await getOwnedItem(client, userId, item.id);
    expect(back.retired).toBe(false);
  });

  it("hides a retired item from the closet unless asked for", async () => {
    const client = db();
    const userId = newUlid();
    const item = await createItem(
      client,
      userId,
      { category: "top", name: "Hidden shirt" },
      "manual",
    );
    await retireItem(client, userId, item.id);

    const visible = await listItems(client, userId);
    expect(visible.items.map((view) => view.item.id)).not.toContain(item.id);

    const withRetired = await listItems(client, userId, {
      includeRetired: true,
    });
    expect(withRetired.items.map((view) => view.item.id)).toContain(item.id);
  });
});

describe("what createItem writes down", () => {
  it("stamps created_at in seconds and starts an item visible", async () => {
    // `visibility` gates whether an item can appear anywhere social; a
    // blank one is a value no reader knows how to interpret.
    const before = Math.floor(Date.now() / 1000);
    const item = await createItem(
      db(),
      newUlid(),
      { category: "top", name: "Fresh shirt" },
      "manual",
    );

    expect(item.createdAt).toBeGreaterThanOrEqual(before - 5);
    expect(item.createdAt).toBeLessThanOrEqual(before + 5);
    expect(item.visibility).toBe("ok");
    expect(item.retired).toBe(false);
  });

  it("stores the attributes the category admits", async () => {
    const item = await createItem(
      db(),
      newUlid(),
      {
        category: "top",
        name: "Attributed shirt",
        layer: "outer",
        weight: "heavy",
        fabric: "merino",
        windResistant: true,
      },
      "manual",
    );

    expect(item.layer).toBe("outer");
    expect(item.weight).toBe("heavy");
    expect(item.fabric).toBe("merino");
    expect(item.windResistant).toBe(true);
  });

  it("ignores half a stored range and estimates instead", async () => {
    // Half a range is not a range: a bound with nothing on the other side
    // is a filter comparing against a number nobody set. The column pair
    // is written straight here, because `createItem` refuses to store one
    // without the other — which is the same rule seen from the other side.
    const client = db();
    const userId = newUlid();
    const item = await createItem(
      client,
      userId,
      { category: "top", name: "Half stored range", layer: "mid" },
      "manual",
    );
    await client
      .update(wardrobeItems)
      .set({ estTempLowC: -3, estTempHighC: sqlNull() })
      .where(eq(wardrobeItems.id, item.id));
    const halfStored = await getOwnedItem(client, userId, item.id);
    expect(halfStored.estTempLowC).toBe(-3);

    const range = effectiveTempRange(halfStored, {
      weight: "mid",
      fabric: undefined,
      windResistant: undefined,
      waterResistant: undefined,
    });

    expect(range?.lowC).not.toBe(-3);
    expect(typeof range?.lowC).toBe("number");
  });

  it("ignores a stated upper bound with no lower one, too", async () => {
    // The half-a-range rule has two halves, and only one of them was
    // covered: a garment stating just the warm end is as unusable as one
    // stating just the cold end.
    const halfStated = await createItem(
      db(),
      newUlid(),
      {
        category: "top",
        name: "High only shirt",
        weight: "mid",
        estTempHighC: 7,
      },
      "manual",
    );

    expect(halfStated.estTempHighC).not.toBe(7);
    expect(typeof halfStated.estTempLowC).toBe("number");
  });

  it("ignores a stored upper bound with no lower one, too", async () => {
    const client = db();
    const userId = newUlid();
    const item = await createItem(
      client,
      userId,
      { category: "top", name: "High only stored", weight: "mid" },
      "manual",
    );
    await client
      .update(wardrobeItems)
      .set({ estTempLowC: sqlNull(), estTempHighC: 7 })
      .where(eq(wardrobeItems.id, item.id));
    const halfStored = await getOwnedItem(client, userId, item.id);
    expect(halfStored.estTempHighC).toBe(7);

    const range = effectiveTempRange(halfStored, {
      weight: "mid",
      fabric: undefined,
      windResistant: undefined,
      waterResistant: undefined,
    });

    expect(range?.highC).not.toBe(7);
    expect(typeof range?.lowC).toBe("number");
  });

  it("keeps a stored range only when both ends are given", async () => {
    // Half a range is not a range: the estimate has to take over, or the
    // filter compares against a bound nobody set.
    const halfStated = await createItem(
      db(),
      newUlid(),
      {
        category: "top",
        name: "Half range shirt",
        weight: "mid",
        estTempLowC: -3,
      },
      "manual",
    );
    // Both ends are the estimate's, not the one that was half-given: a
    // bound with nothing opposite it is not a range to keep, and a garment
    // that states neither still gets an estimate written down.
    expect(halfStated.estTempLowC).not.toBe(-3);
    expect(typeof halfStated.estTempLowC).toBe("number");
    expect(typeof halfStated.estTempHighC).toBe("number");
    // Falls through to the estimate, which always answers with both ends
    // or with nothing at all.
    const range = effectiveTempRange(halfStated, {
      weight: "mid",
      fabric: undefined,
      windResistant: undefined,
      waterResistant: undefined,
    });
    expect(range?.lowC).not.toBe(-3);
  });
});

describe("an item belongs to exactly one runner", () => {
  it("refuses to hand another runner's item over, by name", async () => {
    // The owner clause is the whole authorization story for the closet.
    // Without it every read answers about everyone.
    const client = db();
    const owner = newUlid();
    const item = await createItem(
      client,
      owner,
      { category: "top", name: "Private shirt" },
      "manual",
    );

    await expect(
      getOwnedItem(client, newUlid(), item.id),
    ).rejects.toThrow(/not found/i);
  });
});

/**
A user with the given garments already saved.
*/
async function closetWith(
  garments: Parameters<typeof createItem>[2][],
): Promise<string> {
  const userId = newUlid();
  for (const garment of garments) {
    await createItem(db(), userId, garment, "manual");
  }
  return userId;
}

describe("listItems", () => {
  it("counts everything owned, and how much of it is generic", async () => {
    // `genericCount` drives the "name your gear" nudge (D-27). Counting
    // the wrong side of it turns the prompt on for a closet that is fully
    // named, or off for one that is not.
    const userId = await closetWith([
      { category: "top", name: "Generic one" },
      { category: "top", name: "Generic two" },
    ]);
    const linked = await withResolvedProduct(
      db(),
      { category: "top", name: "Named Half-Zip", brand: "Listbrand" },
      userId,
    );
    await createItem(db(), userId, linked, "manual");

    const listing = await listItems(db(), userId);

    expect(listing.totalCount).toBe(3);
    expect(listing.genericCount).toBe(2);
    expect(listing.items.filter((view) => view.isGeneric)).toHaveLength(2);
  });

  it("inherits a linked product's attributes as defaults", async () => {
    // The read path that makes naming worth doing: the item states
    // nothing, the product does, and the closet shows the product's answer.
    const userId = newUlid();
    const client = db();
    const brand = await createOrGetBrand(client, "Defaults Brand");
    const product = await createOrGetProduct(client, {
      brandId: brand.id,
      name: "Defaults Jacket",
      createdBy: userId,
    });
    await client
      .update(products)
      .set({ weight: "heavy", windResistant: true })
      .where(eq(products.id, product.id));
    await createItem(
      client,
      userId,
      {
        category: "top",
        name: "Defaults Jacket",
        brand: "Defaults Brand",
        productId: product.id,
      },
      "manual",
    );

    const listing = await listItems(client, userId);
    const [view] = listing.items;

    expect(view?.effective.weight).toBe("heavy");
    expect(view?.effective.windResistant).toBe(true);
  });

  it("applies every filter, not the first one that matches", async () => {
    const userId = await closetWith([
      { category: "top", name: "Windy top", windResistant: true },
      { category: "bottom", name: "Windy bottom", windResistant: true },
    ]);

    const both = await listItems(db(), userId, {
      category: "top",
      windResistant: true,
    });

    expect(both.items.map((view) => view.item.name)).toStrictEqual([
      "Windy top",
    ]);
  });

  it("filters by performance bucket, counting an unlogged item as untested", async () => {
    // An item nobody has worn has no performance record at all, and the
    // list still has to be able to answer "show me the untested ones".
    const userId = await closetWith([{ category: "top", name: "Never worn" }]);

    const untested = await listItems(db(), userId, {
      performance: "untested",
    });
    const dialed = await listItems(db(), userId, {
      performance: "most_dialed",
    });

    expect(untested.items).toHaveLength(1);
    expect(dialed.items).toHaveLength(0);
  });
});

describe("getItemDetail", () => {
  it("shows a linked item its product's defaults", async () => {
    const client = db();
    const userId = newUlid();
    const brand = await createOrGetBrand(client, "Detail Brand");
    const product = await createOrGetProduct(client, {
      brandId: brand.id,
      name: "Detail Jacket",
      createdBy: userId,
    });
    await client
      .update(products)
      .set({ fabric: "down" })
      .where(eq(products.id, product.id));
    const item = await createItem(
      client,
      userId,
      {
        category: "top",
        name: "Detail Jacket",
        brand: "Detail Brand",
        productId: product.id,
      },
      "manual",
    );

    const detail = await getItemDetail(client, userId, item.id);

    expect(detail.effective.fabric).toBe("down");
    expect(detail.isGeneric).toBe(false);
  });

  it("asks for no defaults for an item linked to nothing", async () => {
    const client = db();
    const userId = newUlid();
    const item = await createItem(
      client,
      userId,
      { category: "top", name: "Generic detail shirt", fabric: "cotton" },
      "manual",
    );

    const detail = await getItemDetail(client, userId, item.id);

    expect(detail.isGeneric).toBe(true);
    expect(detail.effective.fabric).toBe("cotton");
  });
});

describe("computeUserPerformance reads the clock in seconds", () => {
  it("calls an item worn a year ago a retire candidate", async () => {
    // The one place the current time enters the closet's own logic. In
    // milliseconds every item looks like it was worn in the far future,
    // and nothing is ever a retire candidate again.
    const client = db();
    const userId = newUlid();
    const item = await createItem(
      client,
      userId,
      { category: "top", name: "Forgotten shirt" },
      "manual",
    );
    const aYearAgo = Math.floor(Date.now() / 1000) - 365 * 86_400;
    await logEntryFor(userId, item.id, aYearAgo);

    const performance = await computeUserPerformance(client, userId);

    expect(performance.get(item.id)?.buckets).toContain("retire_candidate");
  });
});

/**
A run and a public entry wearing one item, logged at the given time.
*/
async function logEntryFor(
  userId: string,
  itemId: string,
  createdAt: number,
): Promise<void> {
  const client = db();
  const runId = newUlid();
  const entryId = newUlid();
  await client.insert(runs).values({
    id: runId,
    userId,
    source: "manual",
    startedAt: createdAt,
    durationS: 2400,
    distanceM: 8000,
    indoor: false,
    title: "Old run",
  });
  await client.insert(outfitEntries).values({
    id: entryId,
    userId,
    runId,
    verdict: 0,
    isPublic: true,
    createdAt,
  });
  await client.insert(outfitEntryItems).values({ entryId, itemId });
}

describe("an owner-scoped write touches one row", () => {
  it("retires only the caller's item, not everyone's", async () => {
    // The ownership predicate is shared by every mutation here. Losing it
    // leaves the read-side check intact and the write unscoped, which is a
    // cross-account write that looks correct from the caller's side.
    const client = db();
    const mine = newUlid();
    const theirs = newUlid();
    const myItem = await createItem(
      client,
      mine,
      { category: "top", name: "Mine to retire" },
      "manual",
    );
    const theirItem = await createItem(
      client,
      theirs,
      { category: "top", name: "Theirs to keep" },
      "manual",
    );

    await retireItem(client, mine, myItem.id);

    const retired = await getOwnedItem(client, mine, myItem.id);
    expect(retired.retired).toBe(true);
    const untouched = await getOwnedItem(client, theirs, theirItem.id);
    expect(untouched.retired).toBe(false);
  });
});

describe("a run logged today is not a retire candidate", () => {
  it("reads the clock in seconds, not milliseconds", async () => {
    // In milliseconds `now` lands in the year 57000, every item looks
    // ancient, and the whole closet is suggested for retirement.
    const client = db();
    const userId = newUlid();
    const item = await createItem(
      client,
      userId,
      { category: "top", name: "Worn today" },
      "manual",
    );
    await logEntryFor(userId, item.id, Math.floor(Date.now() / 1000));

    const performance = await computeUserPerformance(client, userId);

    expect(performance.get(item.id)?.buckets).not.toContain("retire_candidate");
  });
});
