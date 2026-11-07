/**
 * Product corrections, the runner's side (D-163; round 48 #129). A runner
 * says one of a shared product's seven facts is wrong, from a garment they
 * own; the Desk's side is `./correction-queue`.
 */
import { and, asc, eq, sql } from "drizzle-orm";

import {
  brands,
  productCorrections,
  products,
  wardrobeItems,
} from "../../db/schema-core";
import { coreDb, primaryCoreDb } from "../../env";
import type { CorrectionField } from "../../lib/contracts/product-corrections";
import { NotFoundError } from "../../lib/errors";
import { newUlid } from "../../lib/ids";
import { nowSeconds } from "../../lib/now";
import { orSqlNull } from "../../lib/sql/sql-null";
import { currentValues, productFactColumns } from "./correction-values";

/**
 * What the runner says is wrong, and the note they add.
 */
interface CorrectionSaid {
  field: CorrectionField;
  value: string;
  note?: string | undefined;
}

export interface CorrectionFiling extends CorrectionSaid {
  productId: string;
  garmentId: string;
  idempotencyKey: string;
}

/**
 * Files a correction, or replaces the one this runner has waiting on the
 * same product and field (R48·129e: one row, refiled date). Law 8b: a
 * repeat of the same key changes nothing.
 *
 * The garment must be the runner's and be this product, read from the
 * primary because it authorizes the write; anything else is not found,
 * the same as a garment that does not exist.
 */
export async function fileCorrection(
  userId: string,
  filing: CorrectionFiling,
): Promise<void> {
  const db = primaryCoreDb();
  const ownsGarment = and(
    eq(wardrobeItems.id, filing.garmentId),
    eq(wardrobeItems.userId, userId),
    eq(wardrobeItems.productId, filing.productId),
  );
  const sameKey = and(
    eq(productCorrections.userId, userId),
    eq(productCorrections.idempotencyKey, filing.idempotencyKey),
  );
  const [owned, repeat] = await db.batch([
    db.select({ id: wardrobeItems.id }).from(wardrobeItems).where(ownsGarment),
    db
      .select({ id: productCorrections.id })
      .from(productCorrections)
      .where(sameKey),
  ]);
  if (repeat.length > 0) return;
  if (owned.length === 0) throw new NotFoundError("Garment not found.");
  const note = filing.note === "" ? undefined : filing.note;
  const now = nowSeconds();
  const refiled = {
    garmentId: filing.garmentId,
    value: filing.value,
    // A refile with no note clears the old one, so NULL rather than omitted.
    note: orSqlNull(note),
    idempotencyKey: filing.idempotencyKey,
    createdAt: now,
  };
  await db
    .insert(productCorrections)
    .values({
      id: newUlid(),
      productId: filing.productId,
      userId,
      field: filing.field,
      ...refiled,
    })
    .onConflictDoUpdate({
      target: [
        productCorrections.userId,
        productCorrections.productId,
        productCorrections.field,
      ],
      targetWhere: sql`${productCorrections.status} = 'waiting'`,
      set: refiled,
    });
}

/**
 * A runner's correction while it waits, for the sheet's line: "You sent
 * "{value}" for {field} on {date}. Sending again replaces it."
 */
export interface WaitingCorrection {
  field: CorrectionField;
  value: string;
  createdAt: number;
}

/**
 * What WRONG?'s sheet reads when it opens: the product as the sheet heads
 * it, what it says now per field ("It says Mid."), and this runner's own
 * waiting corrections on it.
 */
export interface CorrectionContext {
  brandName: string;
  productName: string;
  current: Partial<Record<CorrectionField, string>>;
  waiting: WaitingCorrection[];
}

export async function correctionContext(
  userId: string,
  productId: string,
): Promise<CorrectionContext> {
  const db = coreDb();
  const ownWaiting = and(
    eq(productCorrections.userId, userId),
    eq(productCorrections.productId, productId),
    eq(productCorrections.status, "waiting"),
  );
  const [product, waiting] = await db.batch([
    db
      .select({
        // Aliased: D1 answers by column name, so an unaliased `brands.name`
        // beside `products.name` comes back as the product's.
        brandName: sql<string>`${brands.name}`.as("brand_name"),
        ...productFactColumns(),
      })
      .from(products)
      .innerJoin(brands, eq(brands.id, products.brandId))
      .where(eq(products.id, productId)),
    db
      .select({
        field: productCorrections.field,
        value: productCorrections.value,
        createdAt: productCorrections.createdAt,
      })
      .from(productCorrections)
      .where(ownWaiting)
      .orderBy(asc(productCorrections.field)),
  ]);
  const [row] = product;
  if (row === undefined) throw new NotFoundError("Product not found.");
  return {
    brandName: row.brandName,
    productName: row.name,
    current: currentValues(row),
    waiting,
  };
}
