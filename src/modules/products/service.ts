/**
 * Brand + product identity resolution (D-26/D-30/D-34): create-if-missing on
 * normalized identity, and prefix autocomplete. Products are shared
 * canonical rows — two users typing "Janji" + "Rover Half-Zip" land on the
 * same product row. The enrichment pipeline that fetches/extracts product
 * pages is lane 107's; this module only owns identity + the fields a user
 * can type directly.
 */
import { and, eq, inArray, like } from "drizzle-orm";
import type { drizzle } from "drizzle-orm/d1";

import { brands, products } from "../../db/schema-core";
import { newUlid } from "../../lib/ids";
import { normalizeIdentity } from "../../lib/normalize";

type Db = ReturnType<typeof drizzle>;
export type BrandRow = typeof brands.$inferSelect;
export type ProductRow = typeof products.$inferSelect;

const AUTOCOMPLETE_LIMIT = 8;

/**
 * The autocomplete prefix pattern, or undefined when there is nothing to
 * search for. Both brand and product search built this the same way —
 * normalise, escape, append `%` — and the escaping is the part worth not
 * retyping: a brand with an underscore or percent in it would otherwise
 * turn into a wildcard and match the wrong rows.
 */
function prefixPattern(prefix: string): string | undefined {
  const normalized = normalizeIdentity(prefix);
  return normalized === "" ? undefined : `${escapeLike(normalized)}%`;
}

function escapeLike(value: string): string {
  // Prefix search only: escape SQL LIKE metacharacters in the user's input
  // before appending our own trailing '%'.
  return value.replaceAll("%", String.raw`\%`).replaceAll("_", String.raw`\_`);
}

/**
 * Create-if-missing on normalized brand name (D-30). Concurrent callers
 * typing the same brand converge on one row via the UNIQUE(normalized)
 * index + onConflictDoNothing — no read-then-write race.
 */
export async function createOrGetBrand(
  db: Db,
  name: string,
): Promise<BrandRow> {
  const normalized = normalizeIdentity(name);
  if (normalized === "") {
    throw new Error("Brand name must contain at least one letter or digit.");
  }
  await db
    .insert(brands)
    .values({ id: newUlid(), name: name.trim(), normalized, seeded: false })
    .onConflictDoNothing({ target: brands.normalized });
  const [row] = await db
    .select()
    .from(brands)
    .where(eq(brands.normalized, normalized))
    .limit(1);
  if (!row) throw new Error("Brand create-if-missing failed to resolve.");
  return row;
}

/**
 * Prefix autocomplete over all brands (curated seed + user additions) —
 * not user-scoped, brands are global.
 */
export async function searchBrands(
  db: Db,
  prefix: string,
  limit = AUTOCOMPLETE_LIMIT,
): Promise<BrandRow[]> {
  const likePattern = prefixPattern(prefix);
  if (likePattern === undefined) return [];
  return db
    .select()
    .from(brands)
    .where(like(brands.normalized, likePattern))
    .orderBy(brands.name)
    .limit(limit);
}

export interface CreateProductInput {
  brandId: string;
  name: string;
  sourceUrl?: string | undefined;
  createdBy: string;
}

/**
 * Create-if-missing on UNIQUE(brand_id, normalized_name) (D-30). The first
 * caller's sourceUrl seeds `source_url`; later callers reusing the row don't
 * overwrite it (enrichment owns refreshing product fields, not this path).
 */
export async function createOrGetProduct(
  db: Db,
  input: CreateProductInput,
): Promise<ProductRow> {
  const normalizedName = normalizeIdentity(input.name);
  if (normalizedName === "") {
    throw new Error("Product name must contain at least one letter or digit.");
  }
  await db
    .insert(products)
    .values({
      id: newUlid(),
      brandId: input.brandId,
      name: input.name.trim(),
      normalizedName,
      sourceUrl: input.sourceUrl,
      extractionStatus: "none",
      status: "active",
      createdBy: input.createdBy,
      createdAt: Math.floor(Date.now() / 1000),
    })
    .onConflictDoNothing({
      target: [products.brandId, products.normalizedName],
    });
  const [row] = await db
    .select()
    .from(products)
    .where(
      and(
        eq(products.brandId, input.brandId),
        eq(products.normalizedName, normalizedName),
      ),
    )
    .limit(1);
  if (!row) throw new Error("Product create-if-missing failed to resolve.");
  return row;
}

/**
 * Prefix autocomplete scoped to one brand's active products (retired/hidden
 * products from 106 moderation never surface here).
 */
export async function searchProducts(
  db: Db,
  brandId: string,
  prefix: string,
  limit = AUTOCOMPLETE_LIMIT,
): Promise<ProductRow[]> {
  const likePattern = prefixPattern(prefix);
  if (likePattern === undefined) return [];
  return db
    .select()
    .from(products)
    .where(
      and(
        eq(products.brandId, brandId),
        eq(products.status, "active"),
        like(products.normalizedName, likePattern),
      ),
    )
    .orderBy(products.name)
    .limit(limit);
}

export interface ResolveProductInput {
  brandName: string;
  productName: string;
  sourceUrl?: string | undefined;
  createdBy: string;
}

/**
 * The screen-F identity step in one call: resolve (create-if-missing) the
 * brand, then the product under it. Garment save always has both ids ready
 * to link `product_id`, or the caller skips this entirely for a generic
 * entry (category only).
 */
export async function resolveProduct(
  db: Db,
  input: ResolveProductInput,
): Promise<{ brand: BrandRow; product: ProductRow }> {
  const brand = await createOrGetBrand(db, input.brandName);
  const product = await createOrGetProduct(db, {
    brandId: brand.id,
    name: input.productName,
    sourceUrl: input.sourceUrl,
    createdBy: input.createdBy,
  });
  return { brand, product };
}

export interface ProductAttributeDefaults {
  weight: ProductRow["weight"];
  fabric: ProductRow["fabric"];
  windResistant: boolean | undefined;
  waterResistant: boolean | undefined;
  categoryHint: ProductRow["categoryHint"];
}

/**
 * Read-side default source (docs/contracts.md: "Garments inherit product
 * attributes as defaults where their own columns are NULL"). Closet's
 * service calls this — never the other way — to fill gaps in a linked
 * garment's attributes; the garment's own columns always win when present.
 */
export async function getProductAttributeDefaults(
  db: Db,
  productId: string,
): Promise<ProductAttributeDefaults | undefined> {
  const defaults = await getProductAttributeDefaultsBulk(db, [productId]);
  return defaults.get(productId);
}

/**
 * Batch variant for closet list/detail reads, which need defaults for many
 * linked products in one round trip rather than one query per item.
 */
export async function getProductAttributeDefaultsBulk(
  db: Db,
  productIds: string[],
): Promise<Map<string, ProductAttributeDefaults>> {
  const map = new Map<string, ProductAttributeDefaults>();
  if (productIds.length === 0) return map;
  const rows = await db
    .select({
      id: products.id,
      weight: products.weight,
      fabric: products.fabric,
      windResistant: products.windResistant,
      waterResistant: products.waterResistant,
      categoryHint: products.categoryHint,
    })
    .from(products)
    .where(inArray(products.id, productIds));
  for (const row of rows) {
    map.set(row.id, {
      weight: row.weight,
      fabric: row.fabric,
      // Null means "not stated"; the columns read as booleans otherwise.
      windResistant: row.windResistant ?? undefined,
      waterResistant: row.waterResistant ?? undefined,
      categoryHint: row.categoryHint,
    });
  }
  return map;
}
