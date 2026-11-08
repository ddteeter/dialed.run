import { eq, inArray } from "drizzle-orm";

import { brands, products, wardrobeItems } from "../../src/db/schema-core";
import { newUlid } from "../../src/lib/ids";
import { nowSeconds } from "../../src/lib/now";
import { closetUserId } from "../conformance/closet-seed";
import { withLocalDb } from "../support/local-db";

/**
 * A real 1x1 PNG — small enough to keep the recording quick, and a genuine
 * decodable image, since the closet's photo path decodes and resizes it.
 */
export const PNG_1X1 = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
  "base64",
);

/**
 * A real 2x1 PNG, for Pick another: a different shape from `PNG_1X1`, so
 * the photo that ends up attached can be told apart from the first by its
 * proportions alone — the blur step redraws both, so neither name nor
 * bytes survive it.
 */
export const PNG_2X1 = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAIAAAABCAIAAAB7QOjdAAAADUlEQVR4nGP4zwAE/wEHAAH/4iOeWQAAAABJRU5ErkJggg==",
  "base64",
);

/**
 * The ids of the closet's pieces called `name`: what a save through F made,
 * since the server, not the spec, minted their ids.
 */
export async function itemsNamed(name: string): Promise<string[]> {
  const userId = await closetUserId();
  const pieces = await withLocalDb(({ core }) =>
    core
      .select({ id: wardrobeItems.id, name: wardrobeItems.name })
      .from(wardrobeItems)
      .where(eq(wardrobeItems.userId, userId)),
  );
  return pieces.filter((piece) => piece.name === name).map(({ id }) => id);
}

export async function removeItems(ids: readonly string[]): Promise<void> {
  if (ids.length === 0) return;
  await withLocalDb(({ core }) =>
    core.delete(wardrobeItems).where(inArray(wardrobeItems.id, [...ids])),
  );
}

/**
 * A piece of the closet account's that is a named product: its brand row,
 * its product row, and the garment linked to both, which is what a save
 * through F makes of a brand and a model. Unlinked, a garment reads as a
 * generic piece and the closet drops its brand from its name.
 *
 * The brand's and the product's keys are unique to this seed, so no other
 * run's rows collide with it or are matched by it.
 */
export interface ProductPiece {
  readonly itemId: string;
  readonly productId: string;
  readonly brandId: string;
}

export async function seedProductPiece(
  item: Omit<
    typeof wardrobeItems.$inferInsert,
    "id" | "userId" | "productId" | "brand" | "createdAt"
  > & { brand: string },
  product: Partial<typeof products.$inferInsert> = {},
): Promise<ProductPiece> {
  const userId = await closetUserId();
  const piece = { itemId: newUlid(), productId: newUlid(), brandId: newUlid() };
  const createdAt = nowSeconds();
  await withLocalDb(async ({ core }) => {
    await core.insert(brands).values({
      id: piece.brandId,
      name: item.brand,
      normalized: `e2e ${piece.brandId}`,
    });
    await core.insert(products).values({
      ...product,
      id: piece.productId,
      brandId: piece.brandId,
      name: item.name,
      normalizedName: `e2e ${piece.productId.toLowerCase()}`,
      createdBy: userId,
      createdAt,
    });
    await core.insert(wardrobeItems).values({
      ...item,
      id: piece.itemId,
      userId,
      productId: piece.productId,
      createdAt,
    });
  });
  return piece;
}

export async function removeProductPieces(
  pieces: readonly ProductPiece[],
): Promise<void> {
  await removeItems(pieces.map((piece) => piece.itemId));
  await withLocalDb(async ({ core }) => {
    await core.delete(products).where(
      inArray(
        products.id,
        pieces.map((piece) => piece.productId),
      ),
    );
    await core.delete(brands).where(
      inArray(
        brands.id,
        pieces.map((piece) => piece.brandId),
      ),
    );
  });
}
