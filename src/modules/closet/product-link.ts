/**
 * Naming a garment, and the link a confirmation owes (design 133,
 * decision D-113 Q1).
 *
 * An unconfirmed runner's garments save with the brand and name they
 * typed and no `product_id`, because products and brands are shared rows
 * and an address nobody has confirmed must not add to them. When the
 * runner confirms, `account`'s `confirmEmail` owes this as an outbox row
 * in the same batch as the confirmation (law 8c), and the hourly drain
 * runs it with the Worker entry's wiring (`ops` cannot import this
 * module).
 *
 * **One link, whenever it happens.** `nameItem` for a confirmed runner and
 * `linkTypedGarments` after a confirmation both write `linkedColumns`, so
 * an answer gives the same row whether the runner had confirmed when they
 * gave it or confirmed later. It is a save's link (`productLinkFor`): the
 * typed spelling stays, the product lends its type, and enrichment is
 * asked for.
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
import type { SQLiteUpdateSetSource } from "drizzle-orm/sqlite-core";

import { wardrobeItems } from "../../db/schema-core";
import { normalizeIdentity } from "../../lib/normalize";
import { ownedBy } from "../../lib/sql/owned";
import { isUnconfirmed } from "../account";
import { captureException } from "../ops";
import { createOrGetBrand } from "../products";
import {
  getOwnedItem,
  productLinkFor,
  updateOwnedItem,
  type WardrobeItemRow,
} from "./service";
import { isTapListPlaceholder } from "./tap-list";

type Db = ReturnType<typeof drizzle>;
type Report = typeof captureException;

/**
 * The typed brand, trimmed in SQL so the filter and the value are one
 * expression: a row whose brand is missing or blank is never read. Built
 * on use, not at module scope (CLAUDE.md, the client bundle).
 */
function typedBrand() {
  return sql<string>`trim(${wardrobeItems.brand})`;
}

type TypedRow = Readonly<{
  category: WardrobeItemRow["category"];
  brand: string;
  name: string;
  productUrl: string | null;
  type: string | null;
}>;

/**
 * The columns a link writes. A brand-only answer joins the shared brands,
 * in their spelling, and links no product (rule 04: resolving a product
 * from a brand and no model would invent one named after nothing);
 * anything else links its product as a save would.
 */
async function linkedColumns(
  db: Db,
  userId: string,
  row: TypedRow,
  isBrandOnly: boolean,
): Promise<SQLiteUpdateSetSource<typeof wardrobeItems>> {
  if (isBrandOnly) {
    const found = await createOrGetBrand(db, row.brand);
    return { brand: found.name };
  }
  const link = await productLinkFor(db, row, userId);
  return { productId: link.productId, type: link.type ?? row.type };
}

/**
 * P2.5's write: give a generic garment an identity, and change nothing
 * else about it.
 *
 * **It links a record, it never replaces one** (design §AC rule 05). The
 * row keeps its id, so every verdict, wear count and earned range stays
 * attached — which is the difference between naming a piece and deleting
 * it to add a better one. Only the identity columns move, which is why
 * this does not go through `updateItem`: that rebuilds the whole row from
 * a `Garment`, including the estimated range, and P2.5 has no attribute
 * fields to rebuild it from.
 *
 * **Brand alone is a legitimate answer** (rule 04). A runner who knows it
 * is a Smartwool and not which Smartwool gets a brand and no
 * `product_id` — so no type, no social count, and the row stays on offer.
 *
 * `origin` flips to `manual` because the row is no longer what the
 * tap-list made: a person has told us what it is.
 *
 * **An unconfirmed runner names their own row and nothing shared** (design
 * 133, decision D-113 Q1): the brand and the model are written as typed,
 * no brand or product row is made, and confirming owes the link
 * (`linkTypedGarments`). A brand-only answer keeps the tap list's name,
 * which is how the link tells it from a named model. A confirmed runner's
 * answer is linked here, by the same `linkedColumns`, in the same write.
 */
export async function nameItem(
  db: Db,
  userId: string,
  itemId: string,
  identity: { brand: string; model?: string | undefined },
): Promise<WardrobeItemRow> {
  const model = identity.model?.trim() ?? "";
  const row = await getOwnedItem(db, userId, itemId);
  const typed = {
    brand: identity.brand.trim(),
    name: model === "" ? row.name : model,
    origin: "manual" as const,
  };
  if (await isUnconfirmed(db, userId)) {
    return updateOwnedItem(db, userId, itemId, typed);
  }
  const link = await linkedColumns(
    db,
    userId,
    { ...row, ...typed },
    model === "",
  );
  return updateOwnedItem(db, userId, itemId, { ...typed, ...link });
}

/**
 * Whether the shared catalogue can take this row at all: a brand and a
 * name that both normalize to something ("?" does not). Anything else
 * would make `createOrGetBrand` or `resolveProduct` throw on every run, so
 * it stays as typed, unlinked, and is not retried — it is the runner's own
 * row and reads as they wrote it. A brand-only row's name is the tap
 * list's, which always normalizes, so one rule covers both.
 */
function isLinkable(row: TypedRow): boolean {
  return (
    normalizeIdentity(row.brand) !== "" && normalizeIdentity(row.name) !== ""
  );
}

/**
 * Link every garment of this runner's that carries a typed brand and no
 * product. Nothing at all for a runner still unconfirmed: the debt is
 * owed only by a confirmation, and this says so rather than trusting it.
 *
 * **Each row is its own.** A row the catalogue cannot take is skipped
 * (`isLinkable`), and a row that fails is reported with its id (law 7)
 * while the rest still link. Once the unlinkable are skipped, what is left
 * to fail is the database or a queue, so a failure is thrown after the
 * loop: the outbox row stays owed and the drain retries, re-reading only
 * what is still unlinked, and a row that keeps failing reaches the digest
 * as a terminal outbox row (law 6).
 */
export async function linkTypedGarments(
  db: Db,
  userId: string,
  report: Report = captureException,
): Promise<void> {
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
  let failed = 0;
  for (const row of rows) {
    if (!isLinkable(row)) continue;
    try {
      const link = await linkedColumns(
        db,
        userId,
        row,
        isTapListPlaceholder(row),
      );
      await db
        .update(wardrobeItems)
        .set(link)
        .where(ownedBy(wardrobeItems, { id: row.id, userId }));
    } catch (error) {
      failed += 1;
      report(error, { surface: "product-link", userId, itemId: row.id });
    }
  }
  if (failed > 0) {
    throw new Error(`${String(failed)} garment(s) did not link`);
  }
}
