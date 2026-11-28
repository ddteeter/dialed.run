/**
 * Naming a garment, and the link a confirmation owes (design 133,
 * decision D-113 Q1).
 *
 * An unconfirmed runner's garments save with the brand and name they
 * typed and no `product_id`, because products and brands are shared rows
 * and an address nobody has confirmed must not add to them. When the
 * runner confirms, `account`'s `confirmEmail` owes this as an outbox row
 * in the same batch as the confirmation (law 8c), and the hourly drain
 * runs it through the dispatch, whose registry takes this module's
 * `productLinkHandler` (design 256).
 *
 * **One link, whenever it happens.** `nameItem` for a confirmed runner and
 * `linkTypedGarments` after a confirmation both write `linkedColumns`, so
 * an answer gives the same row whether the runner had confirmed when they
 * gave it or confirmed later. It is a save's link (`productLinkFor`): the
 * typed spelling stays, the product lends its type to a row that has
 * none, and enrichment is asked for.
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
import { isListedName } from "../../lib/contracts/profanity";
import { ownedBy } from "../../lib/sql/owned";
import { isUnconfirmed } from "../account/verification";
import { captureException } from "../ops/sentry";
import {
  OWED_AGAIN,
  outboxInsert,
  oweOutbox,
  type OutboxHandler,
} from "../ops/outbox";
import { createOrGetBrand } from "../products";
import {
  claimSharedRows,
  getOwnedItem,
  isCatalogueName,
  productLinkFor,
  updateOwnedItem,
  type OverSharedRows,
  type WardrobeItemRow,
} from "./service";
import { isTapListPlaceholder } from "./tap-list-placeholder";

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
 * anything else links its product as a save would. Both are counted
 * (`claimSharedRows`): past the runner's day's count no shared row is
 * made, the columns are none, and `until` is when the count starts again.
 */
async function linkedColumns(
  db: Db,
  userId: string,
  row: TypedRow,
  isBrandOnly: boolean,
): Promise<LinkedColumns> {
  if (isBrandOnly) {
    const claim = await claimSharedRows(db, userId, row.brand);
    if (!claim.isAllowed) return { columns: {}, until: claim.until };
    const found = await createOrGetBrand(db, row.brand);
    return { columns: { brand: found.name } };
  }
  const link = await productLinkFor(db, row, userId);
  // The runner's type wins (D-75, R-112): a type picked on F is what they
  // said the piece is, and the product only fills a blank — as a save
  // does (`withResolvedProduct`).
  return "until" in link
    ? { columns: {}, until: link.until }
    : { columns: { productId: link.productId, type: row.type ?? link.type } };
}

/**
What a link writes, and when the runner's count starts again if it wrote
nothing for being past it.
*/
interface LinkedColumns {
  readonly columns: SQLiteUpdateSetSource<typeof wardrobeItems>;
  readonly until?: number;
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
  // Unconfirmed, or a listed word (design 232): saved as typed, no shared row.
  if (
    isListedName(typed.brand) ||
    isListedName(typed.name) ||
    (await isUnconfirmed(db, userId))
  ) {
    return updateOwnedItem(db, userId, itemId, typed);
  }
  const link = await linkedColumns(
    db,
    userId,
    { ...row, ...typed },
    model === "",
  );
  // Past the runner's day's count of new shared rows the columns are
  // none, so the row is saved as typed.
  return updateOwnedItem(db, userId, itemId, { ...typed, ...link.columns });
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
    isCatalogueName(row.brand, row.name) &&
    // A listed word makes no shared row (design 232).
    !isListedName(row.brand) &&
    !isListedName(row.name)
  );
}

/**
Garments one `product_link` run links (design 232).
*/
export const LINK_BATCH = 25;

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
 *
 * **Counted** (`claimSharedRows`): past the runner's day's count of new
 * shared rows the run stops and answers when the count starts again, and
 * the handler owes the link from then.
 *
 * **Bounded** (design 232, SA-L16): at most `LINK_BATCH` garments a run,
 * since each costs several D1 calls and the run shares a cron
 * invocation's budget. Past it the answer is `more`, and the handler owes
 * the link again for the next drain, which re-reads only what is still
 * unlinked.
 */
export async function linkTypedGarments(
  db: Db,
  userId: string,
  report: Report = captureException,
): Promise<LinkRun> {
  if (await isUnconfirmed(db, userId)) return "linked";
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
  const linkable = rows.filter((row) => isLinkable(row));
  let failed = 0;
  for (const row of linkable.slice(0, LINK_BATCH)) {
    try {
      const link = await linkedColumns(
        db,
        userId,
        row,
        isTapListPlaceholder(row),
      );
      // Past the runner's day's count: the rest wait for it to start again.
      if (link.until !== undefined) return { until: link.until };
      await db
        .update(wardrobeItems)
        .set(link.columns)
        .where(ownedBy(wardrobeItems, { id: row.id, userId }));
    } catch (error) {
      failed += 1;
      report(error, { surface: "product-link", userId, itemId: row.id });
    }
  }
  if (failed > 0) {
    throw new Error(`${String(failed)} garment(s) did not link`);
  }
  return linkable.length > LINK_BATCH ? "more" : "linked";
}

/**
 * What a link run answers: everything owed is linked, more are owed to the
 * next drain, or the runner's count of new shared rows is spent until
 * `until`.
 */
export type LinkRun = "linked" | "more" | OverSharedRows;

/**
 * What links a newly confirmed runner's typed garments: `linkTypedGarments`
 * in production, and a test's own where it hands the firing one.
 */
type ProductLinker = (db: Db, userId: string) => Promise<LinkRun>;

/**
 * The `product_link` handler, bound to the linker it is given. With none, it
 * fails loudly, so the row stays owed and the drain reports it, rather
 * than settling a runner's link into nothing.
 */
export function productLinkHandler(
  link: ProductLinker | undefined,
): OutboxHandler<"product_link"> {
  return {
    run: async (db, payload) => {
      if (link === undefined) {
        throw new Error("product_link drained with no linker handed in");
      }
      const run = await link(db, payload.userId);
      // Over the runner's count: the debt is owed again from when the
      // count starts over. The new debt takes this row over, so the
      // settle's delete by this row's id leaves it.
      if (typeof run === "object") {
        await outboxInsert(
          db,
          oweOutbox(
            { kind: "product_link", payload: { userId: payload.userId } },
            run.until,
          ),
        );
        return;
      }
      // A bounded run that left garments unlinked owes the rest to the
      // next drain (design 232): not a failure.
      return run === "more" ? OWED_AGAIN : undefined;
    },
    context: (payload) => ({ userId: payload.userId }),
  };
}
