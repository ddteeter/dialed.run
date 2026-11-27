import { and, count, eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/d1";
import { describe, expect, it } from "vitest";

import { user } from "../../src/db/schema-auth";
import { brands, products, rateLimits } from "../../src/db/schema-core";
import { env } from "../../src/env";
import { garmentSchema } from "../../src/lib/contracts";
import { newUlid } from "../../src/lib/ids";
import { nowSeconds } from "../../src/lib/now";
import {
  addFromTapList,
  getOwnedItem,
  linkTypedGarments,
  nameItem,
  NotFoundError,
} from "../../src/modules/closet";
import {
  createItem,
  updateItemWithProduct,
  withResolvedProduct,
} from "../../src/modules/closet/service";
import { NEW_SHARED_ROWS_PER_RUNNER_PER_DAY } from "../../src/modules/ops/limits/rate-limit";
import { newRowsFor, resolveProduct } from "../../src/modules/products/service";
import { addAccount } from "../feed/helpers";
import { uniqueName } from "../unique-name";

function db() {
  return drizzle(env.DIALED_CORE);
}

async function runner(isConfirmed = true): Promise<string> {
  const userId = newUlid();
  await addAccount(userId, isConfirmed);
  return userId;
}

/**
The runner's count of new shared rows today, or `undefined` before the first.
*/
async function spentBy(userId: string): Promise<number | undefined> {
  const [row] = await db()
    .select({ count: rateLimits.count })
    .from(rateLimits)
    .where(
      and(
        eq(rateLimits.kind, "shared-row-runner"),
        eq(rateLimits.subject, userId),
      ),
    );
  return row?.count;
}

/**
Puts the runner at their day's count, in a window that started now.
*/
async function atTheCount(userId: string): Promise<number> {
  const startedAt = nowSeconds();
  await db().insert(rateLimits).values({
    kind: "shared-row-runner",
    subject: userId,
    count: NEW_SHARED_ROWS_PER_RUNNER_PER_DAY,
    windowStartedAt: startedAt,
  });
  return startedAt;
}

async function brandCount(name: string): Promise<number> {
  const [row] = await db()
    .select({ n: count() })
    .from(brands)
    .where(eq(brands.name, name));
  return row?.n ?? 0;
}

async function productsMadeBy(userId: string): Promise<number> {
  const [row] = await db()
    .select({ n: count() })
    .from(products)
    .where(eq(products.createdBy, userId));
  return row?.n ?? 0;
}

function top(brand: string, name: string) {
  return garmentSchema.parse({ category: "top", brand, name });
}

describe("the day's count of new shared rows", () => {
  it("is fifty a runner (owner, 2026-11-23)", () => {
    expect(NEW_SHARED_ROWS_PER_RUNNER_PER_DAY).toBe(50);
  });

  it("makes no more shared rows once a runner's saves reach it", async () => {
    const userId = await runner();
    // Each save names a new brand and a new model: two rows a save.
    for (let n = 0; n < NEW_SHARED_ROWS_PER_RUNNER_PER_DAY / 2 + 5; n += 1) {
      const garment = top(
        uniqueName(`Probe brand ${String(n)}`),
        uniqueName("Model"),
      );
      await withResolvedProduct(db(), garment, userId);
    }

    expect(await productsMadeBy(userId)).toBe(
      NEW_SHARED_ROWS_PER_RUNNER_PER_DAY / 2,
    );
  });

  it("still saves the garment past it, as typed, with no product", async () => {
    const userId = await runner();
    await atTheCount(userId);
    const brand = uniqueName("Over brand");
    const name = uniqueName("Over model");

    const garment = await withResolvedProduct(db(), top(brand, name), userId);

    expect(garment.productId).toBeUndefined();
    expect(garment.brand).toBe(brand);
    expect(garment.name).toBe(name);
    expect(await brandCount(brand)).toBe(0);
    expect(await spentBy(userId)).toBe(NEW_SHARED_ROWS_PER_RUNNER_PER_DAY + 1);
  });

  it("costs nothing for a brand and model already in the catalogue, even past it", async () => {
    const brand = uniqueName("Known brand");
    const name = uniqueName("Known model");
    const { product } = await resolveProduct(db(), {
      brandName: brand,
      productName: name,
      createdBy: newUlid(),
    });
    const userId = await runner();
    await atTheCount(userId);

    const garment = await withResolvedProduct(db(), top(brand, name), userId);

    expect(garment.productId).toBe(product.id);
    expect(await spentBy(userId)).toBe(NEW_SHARED_ROWS_PER_RUNNER_PER_DAY);
  });

  it("counts one row a new model under a known brand, and two for a new brand", async () => {
    const brand = uniqueName("Half known");
    await resolveProduct(db(), {
      brandName: brand,
      productName: uniqueName("First"),
      createdBy: newUlid(),
    });
    const userId = await runner();

    await withResolvedProduct(db(), top(brand, uniqueName("Second")), userId);
    expect(await spentBy(userId)).toBe(1);

    await withResolvedProduct(
      db(),
      top(uniqueName("New brand"), uniqueName("New model")),
      userId,
    );
    expect(await spentBy(userId)).toBe(3);
  });

  it("refuses the whole when only the first of two rows fits", async () => {
    const userId = await runner();
    await db()
      .insert(rateLimits)
      .values({
        kind: "shared-row-runner",
        subject: userId,
        count: NEW_SHARED_ROWS_PER_RUNNER_PER_DAY - 1,
        windowStartedAt: nowSeconds(),
      });
    const brand = uniqueName("Edge brand");

    const garment = await withResolvedProduct(
      db(),
      top(brand, uniqueName("Edge model")),
      userId,
    );

    expect(garment.productId).toBeUndefined();
    expect(await brandCount(brand)).toBe(0);
  });

  it("is spent only by the runner whose saves made the rows", async () => {
    const other = await runner();
    await atTheCount(other);
    const userId = await runner();

    const garment = await withResolvedProduct(
      db(),
      top(uniqueName("Mine brand"), uniqueName("Mine model")),
      userId,
    );

    expect(garment.productId).toBeDefined();
  });
});

describe("newRowsFor", () => {
  it("answers two for a new brand and model, one for a new brand alone", async () => {
    const brand = uniqueName("Fresh");
    expect(await newRowsFor(db(), brand, "Anything")).toBe(2);
    expect(await newRowsFor(db(), brand)).toBe(1);
  });

  it("answers by the normalized name, as create-if-missing finds it", async () => {
    const brand = uniqueName("Spelled Brand");
    const name = uniqueName("Spelled Model");
    await resolveProduct(db(), {
      brandName: brand,
      productName: name,
      createdBy: newUlid(),
    });
    expect(await newRowsFor(db(), ` ${brand.toUpperCase()} `, name)).toBe(0);
    expect(await newRowsFor(db(), brand)).toBe(0);
    expect(await newRowsFor(db(), brand, uniqueName("Other"))).toBe(1);
  });
});

describe("a name the catalogue cannot take", () => {
  it("saves as typed, and makes no brand row and no count", async () => {
    const userId = await runner();
    const brand = uniqueName("Odd brand");

    const garment = await withResolvedProduct(db(), top(brand, "?"), userId);

    expect(garment.productId).toBeUndefined();
    expect(garment.name).toBe("?");
    expect(await brandCount(brand)).toBe(0);
    expect(await spentBy(userId)).toBeUndefined();
  });

  it("saves a brand that normalizes to nothing as typed", async () => {
    const userId = await runner();

    const garment = await withResolvedProduct(
      db(),
      top("!!", uniqueName("Model")),
      userId,
    );

    expect(garment.productId).toBeUndefined();
    expect(await spentBy(userId)).toBeUndefined();
  });
});

describe("updateItemWithProduct", () => {
  it("reads the garment as the runner's before resolving anything", async () => {
    const owner = await runner();
    const item = await createItem(db(), owner, top("", "A plain top"));
    const userId = await runner();
    const brand = uniqueName("Not yours");

    const edit = top(brand, uniqueName("Model"));
    await expect(
      updateItemWithProduct(db(), userId, item.id, edit),
    ).rejects.toBeInstanceOf(NotFoundError);

    expect(await brandCount(brand)).toBe(0);
    expect(await spentBy(userId)).toBeUndefined();
  });

  it("links the runner's own garment, as a save does", async () => {
    const userId = await runner();
    const item = await createItem(db(), userId, top("", "A plain top"));
    const brand = uniqueName("Yours");

    const updated = await updateItemWithProduct(
      db(),
      userId,
      item.id,
      top(brand, uniqueName("Model")),
    );

    expect(updated.productId).not.toBeNull();
    expect(updated.brand).toBe(brand);
  });
});

describe("the naming step takes the same count", () => {
  it("names a brand alone as typed, past the count, with no brand row", async () => {
    const userId = await runner();
    const [row] = await addFromTapList(db(), userId, { keys: ["merino-base"] });
    if (row === undefined) throw new Error("the tap list made nothing");
    await atTheCount(userId);
    const brand = uniqueName("Named brand");

    const named = await nameItem(db(), userId, row.id, { brand });

    expect(named.brand).toBe(brand);
    expect(named.productId).toBeNull();
    expect(await brandCount(brand)).toBe(0);
  });

  it("names a model as typed, past the count, with no product", async () => {
    const userId = await runner();
    const [row] = await addFromTapList(db(), userId, { keys: ["merino-base"] });
    if (row === undefined) throw new Error("the tap list made nothing");
    await atTheCount(userId);
    const brand = uniqueName("Named brand");
    const model = uniqueName("Named model");

    const named = await nameItem(db(), userId, row.id, { brand, model });

    expect(named).toMatchObject({ brand, name: model });
    expect(named.productId).toBeNull();
    expect(await brandCount(brand)).toBe(0);
  });

  it("makes the brand row while within the count", async () => {
    const userId = await runner();
    const [row] = await addFromTapList(db(), userId, { keys: ["merino-base"] });
    if (row === undefined) throw new Error("the tap list made nothing");
    const brand = uniqueName("Within brand");

    await nameItem(db(), userId, row.id, { brand });

    expect(await brandCount(brand)).toBe(1);
    expect(await spentBy(userId)).toBe(1);
  });
});

describe("the tap list", () => {
  it("makes no shared row and spends nothing", async () => {
    const userId = await runner();

    const made = await addFromTapList(db(), userId, {
      keys: ["merino-base"],
    });

    expect(made).toHaveLength(1);
    expect(made[0]?.productId).toBeNull();
    expect(await spentBy(userId)).toBeUndefined();
  });
});

describe("the link a confirmation owes, past the count", () => {
  it("stops, links nothing more, and says when the count starts again", async () => {
    const userId = await runner(false);
    const first = await createItem(
      db(),
      userId,
      top(uniqueName("Owed brand"), uniqueName("Owed model")),
    );
    await createItem(
      db(),
      userId,
      top(uniqueName("Owed brand"), uniqueName("Owed model")),
    );
    await db()
      .update(user)
      .set({ emailVerified: true })
      .where(eq(user.id, userId));
    const startedAt = await atTheCount(userId);

    const run = await linkTypedGarments(db(), userId);

    expect(run).toStrictEqual({ until: startedAt + 24 * 60 * 60 });
    const unlinked = await getOwnedItem(db(), userId, first.id);
    expect(unlinked.productId).toBeNull();
  });

  it("stops at a brand named alone too, and makes no brand row", async () => {
    const userId = await runner(false);
    const [row] = await addFromTapList(db(), userId, { keys: ["merino-base"] });
    if (row === undefined) throw new Error("the tap list made nothing");
    const brand = uniqueName("Owed alone");
    await nameItem(db(), userId, row.id, { brand });
    await db()
      .update(user)
      .set({ emailVerified: true })
      .where(eq(user.id, userId));
    const startedAt = await atTheCount(userId);

    const run = await linkTypedGarments(db(), userId);

    expect(run).toStrictEqual({ until: startedAt + 24 * 60 * 60 });
    expect(await brandCount(brand)).toBe(0);
  });
});
