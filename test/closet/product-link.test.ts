import { and, eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/d1";
import { afterEach, describe, expect, it, vi } from "vitest";

import { user } from "../../src/db/schema-auth";
import { brands, products, wardrobeItems } from "../../src/db/schema-core";
import { env } from "../../src/env";
import { newUlid } from "../../src/lib/ids";
import {
  addFromTapList,
  getOwnedItem,
  isTapListPlaceholder,
  linkTypedGarments,
  nameItem,
} from "../../src/modules/closet";
import {
  createItem,
  withResolvedProduct,
} from "../../src/modules/closet/service";
import { resolveProduct } from "../../src/modules/products/service";
import { addAccount } from "../feed/helpers";

/**
 * Design 133, decision D-113 Q1: an unconfirmed runner's garments save
 * with what they typed and no shared row — no brand, no product — and the
 * confirmation owes the link, which `linkTypedGarments` pays.
 */
function db() {
  return drizzle(env.DIALED_CORE);
}

afterEach(() => {
  vi.restoreAllMocks();
});

/**
 * A name nobody else could have typed: `brands` and `products` are shared
 * catalogues that no reset clears.
 */
function unique(prefix: string): string {
  return `${prefix}${newUlid()}`;
}

async function runner(isConfirmed: boolean): Promise<string> {
  const userId = newUlid();
  await addAccount(userId, isConfirmed);
  return userId;
}

async function confirm(userId: string): Promise<void> {
  await db()
    .update(user)
    .set({ emailVerified: true })
    .where(eq(user.id, userId));
}

async function brandRows(name: string) {
  return db().select().from(brands).where(eq(brands.name, name));
}

async function productRows(name: string) {
  return db().select().from(products).where(eq(products.name, name));
}

/**
A tap-list row, as O3 makes it: generic, with the tap list's own name.
*/
async function tapListRow(userId: string): Promise<string> {
  const [row] = await addFromTapList(db(), userId, { keys: ["merino-base"] });
  if (row === undefined) throw new Error("the tap list made nothing");
  return row.id;
}

describe("withResolvedProduct for an unconfirmed runner", () => {
  it("keeps what was typed and makes no brand or product", async () => {
    const userId = await runner(false);
    const brand = unique("Brand");
    const name = unique("Tee");

    const resolved = await withResolvedProduct(
      db(),
      { category: "top", name, brand },
      userId,
    );

    expect(resolved.productId).toBeUndefined();
    expect(resolved.brand).toBe(brand);
    expect(resolved.name).toBe(name);
    expect(await brandRows(brand)).toHaveLength(0);
    expect(await productRows(name)).toHaveLength(0);
  });

  it("drops a product id the request carried", async () => {
    // The garment is a trust boundary: an id sent with it would link a
    // shared product all the same.
    const userId = await runner(false);
    const resolved = await withResolvedProduct(
      db(),
      { category: "top", name: "Tee", brand: "Janji", productId: newUlid() },
      userId,
    );
    expect(resolved.productId).toBeUndefined();
  });

  it("asks for no enrichment", async () => {
    const send = vi.spyOn(env.ENRICHMENT_QUEUE, "send");
    await withResolvedProduct(
      db(),
      {
        category: "top",
        name: unique("Tee"),
        brand: unique("Brand"),
        productUrl: "https://shop.example.com/products/tee",
      },
      await runner(false),
    );
    expect(send).not.toHaveBeenCalled();
  });

  it("still links for a confirmed runner", async () => {
    const resolved = await withResolvedProduct(
      db(),
      { category: "top", name: unique("Tee"), brand: unique("Brand") },
      await runner(true),
    );
    expect(resolved.productId).toBeDefined();
  });
});

describe("nameItem for an unconfirmed runner", () => {
  it("writes the brand and the model as typed, and makes nothing shared", async () => {
    const userId = await runner(false);
    const itemId = await tapListRow(userId);
    const brand = unique("Brand");
    const model = unique("Model");

    const named = await nameItem(db(), userId, itemId, {
      brand: ` ${brand} `,
      model: ` ${model} `,
    });

    expect(named.id).toBe(itemId);
    expect(named.brand).toBe(brand);
    expect(named.name).toBe(model);
    expect(named.productId).toBeNull();
    expect(named.origin).toBe("manual");
    expect(await brandRows(brand)).toHaveLength(0);
    expect(await productRows(model)).toHaveLength(0);
  });

  it("keeps the tap list's name for a brand alone, or a blank model", async () => {
    const userId = await runner(false);
    for (const model of [undefined, " ".repeat(3)]) {
      const itemId = await tapListRow(userId);
      const brand = unique("Brand");

      const named = await nameItem(db(), userId, itemId, { brand, model });

      expect(named.brand).toBe(brand);
      expect(named.name).toBe("Merino base layer");
      expect(named.productId).toBeNull();
      expect(named.origin).toBe("manual");
      expect(await brandRows(brand)).toHaveLength(0);
    }
  });
});

/**
The row an answer leaves, without what differs by runner.
*/
function identityOf(row: Awaited<ReturnType<typeof getOwnedItem>>) {
  return {
    brand: row.brand,
    name: row.name,
    productId: row.productId,
    type: row.type,
    origin: row.origin,
  };
}

describe("nameItem for a confirmed runner — the link a confirmation owes, now", () => {
  it("gives the same row as naming unconfirmed and then confirming", async () => {
    const brand = unique("Brand");
    const model = unique("Model");
    const { product } = await resolveProduct(db(), {
      brandName: brand.toUpperCase(),
      productName: model.toUpperCase(),
      createdBy: newUlid(),
    });
    await db()
      .update(products)
      .set({ type: "longSleeve" })
      .where(eq(products.id, product.id));

    const now = await runner(true);
    const nowItem = await tapListRow(now);
    const named = await nameItem(db(), now, nowItem, { brand, model });

    const later = await runner(false);
    const laterItem = await tapListRow(later);
    await nameItem(db(), later, laterItem, { brand, model });
    await confirm(later);
    await linkTypedGarments(db(), later);
    const linked = await getOwnedItem(db(), later, laterItem);

    expect(identityOf(named)).toStrictEqual(identityOf(linked));
    // A save's link: the typed spelling stays, and the product lends its
    // type.
    expect(identityOf(named)).toStrictEqual({
      brand,
      name: model,
      productId: product.id,
      type: "longSleeve",
      origin: "manual",
    });
  });

  it("asks for enrichment of the product it links, as a save does", async () => {
    const userId = await runner(true);
    const itemId = await tapListRow(userId);
    const send = vi.spyOn(env.ENRICHMENT_QUEUE, "send");
    const brand = unique("Brand");
    const model = unique("Model");
    const { product } = await resolveProduct(db(), {
      brandName: brand,
      productName: model,
      sourceUrl: "https://shop.example.com/products/tee",
      createdBy: newUlid(),
    });

    await nameItem(db(), userId, itemId, { brand, model });

    expect(send).toHaveBeenCalledWith({
      type: "enrich",
      productId: product.id,
    });
  });

  it("gives a brand alone the shared brand's spelling, and no product", async () => {
    const brand = unique("Canonical");
    await db().insert(brands).values({
      id: newUlid(),
      name: brand,
      normalized: brand.toLowerCase(),
    });
    const userId = await runner(true);
    const itemId = await tapListRow(userId);

    const named = await nameItem(db(), userId, itemId, {
      brand: brand.toUpperCase(),
      model: " ",
    });

    expect(identityOf(named)).toMatchObject({
      brand,
      name: "Merino base layer",
      origin: "manual",
    });
    expect(named.productId).toBeNull();
  });
});

/**
A product whose type is `longSleeve`, under a brand and model nobody else typed.
*/
async function longSleeveProduct() {
  const brand = unique("Brand");
  const model = unique("Model");
  const { product } = await resolveProduct(db(), {
    brandName: brand,
    productName: model,
    createdBy: newUlid(),
  });
  await db()
    .update(products)
    .set({ type: "longSleeve" })
    .where(eq(products.id, product.id));
  return { brand, model, product };
}

/**
A tap-list row the runner gave a type on F.
*/
async function pickedHalfZip(userId: string): Promise<string> {
  const itemId = await tapListRow(userId);
  await db()
    .update(wardrobeItems)
    .set({ type: "halfZip" })
    .where(eq(wardrobeItems.id, itemId));
  return itemId;
}

describe("the runner's type wins over the product's (D-75)", () => {
  it("keeps a confirmed runner's pick when naming links a typed product", async () => {
    const { brand, model, product } = await longSleeveProduct();
    const userId = await runner(true);
    const itemId = await pickedHalfZip(userId);

    const named = await nameItem(db(), userId, itemId, { brand, model });

    expect(named.productId).toBe(product.id);
    expect(named.type).toBe("halfZip");
  });

  it("keeps an unconfirmed runner's pick when confirming links a typed product", async () => {
    const { brand, model, product } = await longSleeveProduct();
    const userId = await runner(false);
    const itemId = await pickedHalfZip(userId);
    await nameItem(db(), userId, itemId, { brand, model });

    await confirm(userId);
    await linkTypedGarments(db(), userId);

    const linked = await getOwnedItem(db(), userId, itemId);
    expect(linked.productId).toBe(product.id);
    expect(linked.type).toBe("halfZip");
  });
});

describe("isTapListPlaceholder", () => {
  it("is the tap list's own name, in its own category", () => {
    expect(
      isTapListPlaceholder({ category: "top", name: "Merino base layer" }),
    ).toBe(true);
    // The same words in another category are somebody's model.
    expect(
      isTapListPlaceholder({ category: "bottom", name: "Merino base layer" }),
    ).toBe(false);
    expect(isTapListPlaceholder({ category: "top", name: "Intraknit" })).toBe(
      false,
    );
  });
});

describe("linkTypedGarments — the link a confirmation owes", () => {
  it("links a named model to the shared product once the runner confirms", async () => {
    const userId = await runner(false);
    const itemId = await tapListRow(userId);
    const brand = unique("Brand");
    const model = unique("Model");
    await nameItem(db(), userId, itemId, { brand, model });
    await db()
      .update(wardrobeItems)
      .set({ type: "longSleeve" })
      .where(eq(wardrobeItems.id, itemId));

    await confirm(userId);
    await linkTypedGarments(db(), userId);

    const linked = await getOwnedItem(db(), userId, itemId);
    const [product] = await productRows(model);
    expect(product).toBeDefined();
    expect(linked.productId).toBe(product?.id);
    // The row's own type stays: the new product has none to lend.
    expect(linked.type).toBe("longSleeve");
    expect(await brandRows(brand)).toHaveLength(1);
  });

  it("links nothing while the runner is still unconfirmed", async () => {
    const userId = await runner(false);
    const brand = unique("Brand");
    const name = unique("Tee");
    const item = await createItem(db(), userId, {
      category: "top",
      name,
      brand,
    });

    await linkTypedGarments(db(), userId);

    const unlinked = await getOwnedItem(db(), userId, item.id);
    expect(unlinked.productId).toBeNull();
    expect(await brandRows(brand)).toHaveLength(0);
  });

  it("joins a brand-only name to the shared brands and invents no product", async () => {
    const userId = await runner(false);
    const itemId = await tapListRow(userId);
    const brand = unique("brand");
    await nameItem(db(), userId, itemId, { brand });

    await confirm(userId);
    await linkTypedGarments(db(), userId);

    const linked = await getOwnedItem(db(), userId, itemId);
    expect(linked.productId).toBeNull();
    expect(linked.name).toBe("Merino base layer");
    const [made] = await brandRows(linked.brand ?? "");
    expect(made).toBeDefined();
    expect(await productRows("Merino base layer")).toHaveLength(0);
  });

  it("writes the shared brand's own spelling onto a brand-only row", async () => {
    const userId = await runner(true);
    const brand = unique("Canonical");
    const itemId = await tapListRow(userId);
    await db().insert(brands).values({
      id: newUlid(),
      name: brand,
      normalized: brand.toLowerCase(),
    });
    await db()
      .update(wardrobeItems)
      .set({ brand: brand.toUpperCase() })
      .where(eq(wardrobeItems.id, itemId));

    await linkTypedGarments(db(), userId);

    const linked = await getOwnedItem(db(), userId, itemId);
    expect(linked.brand).toBe(brand);
  });

  it("lends the product's type when it belongs to the garment's category", async () => {
    const userId = await runner(true);
    const brand = unique("Brand");
    const name = unique("Tee");
    const { product } = await resolveProduct(db(), {
      brandName: brand,
      productName: name,
      createdBy: newUlid(),
    });
    await db()
      .update(products)
      .set({ type: "tee" })
      .where(eq(products.id, product.id));
    const item = await createItem(db(), userId, {
      category: "top",
      name,
      brand,
    });

    await linkTypedGarments(db(), userId);

    const linked = await getOwnedItem(db(), userId, item.id);
    expect(linked.productId).toBe(product.id);
    expect(linked.type).toBe("tee");
  });

  it("asks for enrichment of a product with a URL", async () => {
    const userId = await runner(true);
    const item = await createItem(db(), userId, {
      category: "top",
      name: unique("Tee"),
      brand: unique("Brand"),
      productUrl: "https://shop.example.com/products/tee",
    });
    const send = vi.spyOn(env.ENRICHMENT_QUEUE, "send");

    await linkTypedGarments(db(), userId);

    const linked = await getOwnedItem(db(), userId, item.id);
    expect(send).toHaveBeenCalledWith({
      type: "enrich",
      productId: linked.productId,
    });
  });

  it("leaves a row with no brand, or a blank one, alone", async () => {
    const userId = await runner(true);
    const generic = await tapListRow(userId);
    const blank = await createItem(db(), userId, {
      category: "top",
      name: unique("Tee"),
    });
    await db()
      .update(wardrobeItems)
      .set({ brand: " ".repeat(3) })
      .where(eq(wardrobeItems.id, blank.id));

    await linkTypedGarments(db(), userId);

    const stillGeneric = await getOwnedItem(db(), userId, generic);
    expect(stillGeneric.brand).toBeNull();
    const untouched = await getOwnedItem(db(), userId, blank.id);
    expect(untouched.brand).toBe(" ".repeat(3));
    expect(untouched.productId).toBeNull();
  });

  it("leaves a row the catalogue cannot take as typed, and still links the rest", async () => {
    // A brand of only punctuation, or a model of it, normalizes to
    // nothing: find-or-create would throw on every run.
    const userId = await runner(false);
    const good = await createItem(db(), userId, {
      category: "top",
      name: unique("Tee"),
      brand: unique("Brand"),
    });
    const noBrand = await createItem(db(), userId, {
      category: "top",
      name: unique("Tee"),
      brand: "?",
    });
    const noName = await createItem(db(), userId, {
      category: "top",
      name: "?",
      brand: unique("Brand"),
    });
    const report = vi.fn();

    await confirm(userId);
    await linkTypedGarments(db(), userId, report);

    const linked = await getOwnedItem(db(), userId, good.id);
    expect(linked.productId).not.toBeNull();
    for (const typed of [noBrand, noName]) {
      const left = await getOwnedItem(db(), userId, typed.id);
      expect(left.productId).toBeNull();
      expect({ brand: left.brand, name: left.name }).toStrictEqual({
        brand: typed.brand,
        name: typed.name,
      });
    }
    expect(report).not.toHaveBeenCalled();
  });

  it("reports a row that fails, links the others, and leaves the debt owed", async () => {
    const userId = await runner(true);
    const items = [
      await createItem(db(), userId, {
        category: "top",
        name: unique("Tee"),
        brand: unique("Brand"),
      }),
      await createItem(db(), userId, {
        category: "top",
        name: unique("Tee"),
        brand: unique("Brand"),
      }),
    ];
    const client = db();
    const outage = new Error("D1 is down");
    // The first garment's write fails; every other update, enrichment's
    // own included, goes through.
    const update = client.update.bind(client);
    let isDown = true;
    vi.spyOn(client, "update").mockImplementation((table) => {
      if (table === wardrobeItems && isDown) {
        isDown = false;
        throw outage;
      }
      return update(table);
    });
    const report = vi.fn();

    await expect(linkTypedGarments(client, userId, report)).rejects.toThrow(
      "1 garment(s) did not link",
    );

    const after = await Promise.all(
      items.map(async (item) => getOwnedItem(db(), userId, item.id)),
    );
    const failed = after.filter((row) => row.productId === null);
    expect(failed).toHaveLength(1);
    expect(report).toHaveBeenCalledExactlyOnceWith(outage, {
      surface: "product-link",
      userId,
      itemId: failed[0]?.id,
    });
  });

  it("touches only this runner's garments", async () => {
    const userId = await runner(true);
    const other = await runner(true);
    const name = unique("Tee");
    const theirs = await createItem(db(), other, {
      category: "top",
      name,
      brand: unique("Brand"),
    });

    await linkTypedGarments(db(), userId);

    const notMine = await getOwnedItem(db(), other, theirs.id);
    expect(notMine.productId).toBeNull();
    expect(await productRows(name)).toHaveLength(0);
  });

  it("can run again, and changes nothing the first run did", async () => {
    const userId = await runner(true);
    const name = unique("Tee");
    const item = await createItem(db(), userId, {
      category: "top",
      name,
      brand: unique("Brand"),
    });

    await linkTypedGarments(db(), userId);
    const first = await getOwnedItem(db(), userId, item.id);
    await linkTypedGarments(db(), userId);

    expect(await getOwnedItem(db(), userId, item.id)).toStrictEqual(first);
    expect(await productRows(name)).toHaveLength(1);
    const [owned] = await db()
      .select({ id: wardrobeItems.id })
      .from(wardrobeItems)
      .where(
        and(
          eq(wardrobeItems.userId, userId),
          eq(wardrobeItems.productId, first.productId ?? ""),
        ),
      );
    expect(owned?.id).toBe(item.id);
  });
});
