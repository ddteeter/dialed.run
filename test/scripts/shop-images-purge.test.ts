import { afterEach, describe, expect, it, vi } from "vitest";

import { env } from "../../src/env";
import { newUlid } from "../../src/lib/ids";
import {
  isShopImageKey,
  purgeShopImages,
  shopImageKeys,
} from "../../scripts/shop-images/purge";

/**
 * The purge against a real R2 (the worker pool's MEDIA), with keys shaped
 * the way the consumer wrote them before D-176 and the way the snapshots
 * still are.
 */

async function put(key: string): Promise<void> {
  await env.MEDIA.put(key, "x");
}

function byKey(a: string, b: string): number {
  return a.localeCompare(b);
}

async function keysUnder(prefix: string): Promise<string[]> {
  const listed = await env.MEDIA.list({ prefix });
  return listed.objects.map((object) => object.key);
}

afterEach(async () => {
  const listed = await env.MEDIA.list({ prefix: "products/" });
  await env.MEDIA.delete(listed.objects.map((object) => object.key));
});

describe("isShopImageKey", () => {
  it.each([
    ["products/01J/image-1730000000000", true],
    ["products/01J/image-1", true],
    // A snapshot shares the prefix and is kept (D-31).
    ["products/01J/snapshot-1730000000000.html", false],
    ["products/01J/image-", false],
    ["products/01J/image-17x", false],
    ["products/01J/image-17.webp", false],
    ["products/01J/nested/image-17", false],
    ["products//image-17", false],
    ["entries/01J/image-17", false],
    ["xproducts/01J/image-17", false],
  ])("%s → %s", (key, expected) => {
    expect(isShopImageKey(key)).toBe(expected);
  });
});

describe("purgeShopImages", () => {
  it("on a dry run lists the shop images and deletes nothing", async () => {
    const id = newUlid();
    await put(`products/${id}/image-1`);
    await put(`products/${id}/snapshot-1.html`);

    const result = await purgeShopImages(env.MEDIA, { apply: false });

    expect(result).toStrictEqual({
      keys: [`products/${id}/image-1`],
      isDeleted: false,
    });
    expect(await keysUnder(`products/${id}/`)).toStrictEqual([
      `products/${id}/image-1`,
      `products/${id}/snapshot-1.html`,
    ]);
  });

  it("with apply deletes the shop images and keeps the snapshots", async () => {
    const first = newUlid();
    const second = newUlid();
    await put(`products/${first}/image-1`);
    await put(`products/${first}/snapshot-1.html`);
    await put(`products/${second}/image-2`);

    const result = await purgeShopImages(env.MEDIA, { apply: true });

    expect(result.isDeleted).toBe(true);
    expect(result.keys.toSorted(byKey)).toStrictEqual(
      [`products/${first}/image-1`, `products/${second}/image-2`].toSorted(
        byKey,
      ),
    );
    expect(await keysUnder("products/")).toStrictEqual([
      `products/${first}/snapshot-1.html`,
    ]);
    // Re-runnable: nothing left to find.
    expect(await purgeShopImages(env.MEDIA, { apply: true })).toStrictEqual({
      keys: [],
      isDeleted: true,
    });
  });

  it("deletes nothing when there is nothing to delete", async () => {
    await put(`products/${newUlid()}/snapshot-1.html`);
    const remove = vi.spyOn(env.MEDIA, "delete");
    expect(await purgeShopImages(env.MEDIA, { apply: true })).toStrictEqual({
      keys: [],
      isDeleted: true,
    });
    expect(remove).not.toHaveBeenCalled();
    remove.mockRestore();
  });

  it("deletes in batches of 1000, R2's cap on one call", async () => {
    const keys = Array.from(
      { length: 2001 },
      (_, index) => `products/p${String(index).padStart(4, "0")}/image-1`,
    );
    await Promise.all(keys.map((key) => put(key)));
    const remove = vi.spyOn(env.MEDIA, "delete");

    await purgeShopImages(env.MEDIA, { apply: true });

    const batches = remove.mock.calls.map(([batch]) => [batch].flat());
    expect(batches.map((batch) => batch.length)).toStrictEqual([1000, 1000, 1]);
    expect(batches.flat()).toStrictEqual(keys);
    expect(await keysUnder("products/")).toStrictEqual([]);
    remove.mockRestore();
  });
});

describe("shopImageKeys", () => {
  it("follows the cursor past one list page, asking under products/", async () => {
    // R2's list returns at most 1000 objects, so a bucket with more takes
    // more than one page. 1001 images and a snapshot interleaved.
    const ids = Array.from(
      { length: 1001 },
      (_, index) => `p${String(index).padStart(4, "0")}`,
    );
    for (const id of ids) await put(`products/${id}/image-1`);
    await put(`products/p0500/snapshot-1.html`);
    await put("entries/x/image-1");
    const list = vi.spyOn(env.MEDIA, "list");

    const keys = await shopImageKeys(env.MEDIA);

    expect(keys).toStrictEqual(ids.map((id) => `products/${id}/image-1`));
    expect(list).toHaveBeenCalledTimes(2);
    expect(list.mock.calls[0]?.[0]).toStrictEqual({
      prefix: "products/",
      limit: 1000,
    });
    const second = list.mock.calls[1]?.[0];
    expect(second?.prefix).toBe("products/");
    expect(second?.limit).toBe(1000);
    expect(second?.cursor).toStrictEqual(expect.stringMatching(/./u));
    list.mockRestore();
    await env.MEDIA.delete("entries/x/image-1");
  });
});
