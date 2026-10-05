/**
 * The link a confirmation owes (design 133, decision D-113 Q1).
 *
 * An unconfirmed runner's garments save with the brand and name they
 * typed and no `product_id`, because products and brands are shared rows
 * and an address nobody has confirmed must not add to them. When the
 * runner confirms, `account`'s `confirmEmail` owes this as an outbox row
 * in the same batch as the confirmation (law 8c), and the hourly drain
 * runs it with the Worker entry's wiring (`ops` cannot import this
 * module).
 *
 * **Re-runnable from any point** (law 1). It reads only rows still
 * unlinked, and the find-or-create underneath is idempotent on the
 * normalized brand and name, so a second run after a half-finished first
 * links what is left and changes nothing else. Two runs at once both find
 * the same product and write the same id (law 2's concern, answered by
 * the outbox's claim and, under it, by every write here being a set to
 * the same value).
 */
import { and, eq, isNull, sql } from "drizzle-orm";
import type { drizzle } from "drizzle-orm/d1";

import { wardrobeItems } from "../../db/schema-core";
import { ownedBy } from "../../lib/sql/owned";
import { isUnconfirmed } from "../account";
import { createOrGetBrand } from "../products";
import { productLinkFor } from "./service";
import { isTapListPlaceholder } from "./tap-list";

type Db = ReturnType<typeof drizzle>;

/**
 * The typed brand, trimmed in SQL so the filter and the value are one
 * expression: a row whose brand is missing or blank is never read. Built
 * on use, not at module scope (CLAUDE.md, the client bundle).
 */
function typedBrand() {
  return sql<string>`trim(${wardrobeItems.brand})`;
}

type UnlinkedRow = Readonly<{
  id: string;
  category: (typeof wardrobeItems.$inferSelect)["category"];
  brand: string;
  name: string;
  productUrl: string | null;
  type: string | null;
}>;

/**
 * One row's link: a brand-only name (the tap list's name, kept) joins the
 * shared brands as `nameItem` does for a confirmed runner, and links no
 * product; anything else links its product as a save would.
 */
async function linkRow(db: Db, userId: string, row: UnlinkedRow) {
  const mine = ownedBy(wardrobeItems, { id: row.id, userId });
  if (isTapListPlaceholder(row)) {
    const found = await createOrGetBrand(db, row.brand);
    await db.update(wardrobeItems).set({ brand: found.name }).where(mine);
    return;
  }
  const link = await productLinkFor(db, row, userId);
  await db
    .update(wardrobeItems)
    .set({ productId: link.productId, type: link.type ?? row.type })
    .where(mine);
}

/**
 * Link every garment of this runner's that carries a typed brand and no
 * product. Nothing at all for a runner still unconfirmed: the debt is
 * owed only by a confirmation, and this says so rather than trusting it.
 */
export async function linkTypedGarments(db: Db, userId: string): Promise<void> {
  if (await isUnconfirmed(db, userId)) return;
  // `wardrobe_user_category` leads on the runner, so this reads only
  // their rows.
  const rows = await db
    .select({
      id: wardrobeItems.id,
      category: wardrobeItems.category,
      brand: typedBrand(),
      name: wardrobeItems.name,
      productUrl: wardrobeItems.productUrl,
      type: wardrobeItems.type,
    })
    .from(wardrobeItems)
    .where(
      and(
        eq(wardrobeItems.userId, userId),
        isNull(wardrobeItems.productId),
        sql`${typedBrand()} <> ''`,
      ),
    );
  for (const row of rows) await linkRow(db, userId, row);
}
