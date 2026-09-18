import { and, eq, isNull } from "drizzle-orm";
import type { drizzle } from "drizzle-orm/d1";
import { z } from "zod";

import { products, type productSnapshots } from "../../db/schema-core";
import {
  extractedProductSchema,
  garmentCategories,
  type ExtractedProduct,
} from "../../lib/contracts";

type Db = ReturnType<typeof drizzle>;
type ProductRow = typeof products.$inferSelect;
type Patch = Partial<typeof products.$inferInsert>;
type Rung = typeof productSnapshots.$inferInsert.rung;

/**
 * Write what the ladder found onto the product row — and never over what a
 * human wrote.
 *
 * **Precedence is derived, not stored** (design doc, decided 2). "Never
 * overwrite a field a human edited" needs one bit per column, and the row
 * has no such bit. Fill-only-what-is-null cannot stand in for it: a field a
 * human deliberately *cleared* looks identical to one nobody ever set, and
 * filling it puts the machine's answer back over a person's decision.
 *
 * So the row carries a ledger — `products.extracted` — of what enrichment
 * last **wrote** to each column, and the bit is the comparison:
 *
 * | column now      | ledger says we wrote | incoming | do                 |
 * | --------------- | -------------------- | -------- | ------------------ |
 * | null            | nothing              | value    | **fill**           |
 * | null            | something            | value    | keep — cleared     |
 * | = what we wrote | that                 | same     | nothing to do      |
 * | = what we wrote | that                 | new      | **refresh** — ours |
 * | ≠ what we wrote | anything             | value    | keep — edited      |
 * | anything        | anything             | absent   | nothing to say     |
 *
 * A column a human has touched stays theirs forever, because the ledger
 * still records what *we* wrote and the column will never equal it again.
 * That is the intended asymmetry: the ladder gets better, and a person's
 * correction still wins.
 *
 * **Compare-and-set, not read-then-write.** The read and the update are two
 * statements, and a person could edit between them. The update therefore
 * matches the ledger it read (`WHERE extracted = …`, or `IS NULL`), so a
 * concurrent edit makes it match nothing and the call throws instead of
 * clobbering. The consumer's redelivery is the retry (law 3); the whole job
 * is idempotent on its snapshot, so re-running is cheap and safe.
 */

/**
 * The ledger: the ladder's full output (`found`, D-31 "raw extras" — name,
 * brand, image, extras, everything a column does not have a home for), the
 * rung that produced it, and `written`, which is the precedence record: the
 * value this module last put in each column, keyed by the column's field.
 *
 * Parsed on the way back in, strictly. A ledger this module cannot read is
 * a ledger it cannot prove precedence against, and the safe answer to that
 * is to refuse to write — a throw the consumer records as a failed job —
 * rather than to treat the row as fresh and overwrite whatever is there.
 */
const cellSchema = z.union([z.string(), z.boolean()]);
const ledgerSchema = z.object({
  rung: z.string(),
  found: extractedProductSchema,
  written: z.record(z.string(), cellSchema),
});
type Ledger = z.infer<typeof ledgerSchema>;
type Cell = string | boolean;

/**
 * A garment category out of the ladder's free-text hint, or nothing.
 *
 * The column is documented as a category enum value and the closet reads
 * it as one, while the ladder emits whatever the shop wrote — "men's
 * pants/jogger", "Accessory". Only an exact member of the enum is written;
 * the rest stays in `found` for a mapper that does not exist yet.
 */
// A `Set<string>` rather than `.includes` on the tuple: the tuple's
// `includes` wants one of its own literals, and a hint is any string.
const CATEGORIES = new Set<string>(garmentCategories);

function asCategory(hint: string | undefined): string | undefined {
  if (hint === undefined) return undefined;
  const lowered = hint.trim().toLowerCase();
  return CATEGORIES.has(lowered) ? lowered : undefined;
}

/**
 * One typed column the ladder can fill: how to read it off the row, and how
 * to find it in the ladder's output. `find` hands back the comparable cell
 * *and* the write, together, so the write is only ever built from a value
 * that exists — there is no "apply the composition" that has to ask again
 * whether there was one. For the composition the cell is `verbatim` and the
 * write covers both columns, because they move together or not at all.
 */
interface Found {
  cell: Cell;
  write: (patch: Patch) => void;
}
interface Column {
  field: string;
  current: (row: ProductRow) => Cell | null;
  find: (extracted: ExtractedProduct) => Found | undefined;
}

/**
 * A column whose cell is the value itself. `T` is inferred from `pick`, so
 * `write` is typed to its own column with no cast — the reason this is a
 * function of four closures rather than a table keyed by field name, which
 * TypeScript can only type as the intersection of every column.
 */
function plain<T extends Cell>(
  field: string,
  current: (row: ProductRow) => T | null,
  pick: (extracted: ExtractedProduct) => T | undefined,
  write: (patch: Patch, value: T) => void,
): Column {
  return {
    field,
    current,
    find: (extracted) => {
      const value = pick(extracted);
      if (value === undefined) return;
      return {
        cell: value,
        write: (patch) => {
          write(patch, value);
        },
      };
    },
  };
}

/**
 * The two nullable flags are one idea, and they are the one place a
 * field-name key works: both columns are `boolean | null` and both findings
 * `boolean | undefined`, so the write is typed as their intersection and
 * the intersection is still `boolean`. Weight and fabric are different
 * enums, which is why they cannot join this and are spelled out below.
 */
function flag(field: "windResistant" | "waterResistant"): Column {
  return plain(
    field,
    (row) => row[field],
    (extracted) => extracted[field],
    (patch, value) => {
      patch[field] = value;
    },
  );
}

const COLUMNS: readonly Column[] = [
  {
    field: "fabricComposition",
    current: (row) => row.fabricComposition,
    find: (extracted) => {
      const composition = extracted.fabricComposition;
      if (composition === undefined) return;
      return {
        cell: composition.verbatim,
        write: (patch) => {
          patch.fabricComposition = composition.verbatim;
          patch.fabricParts = JSON.stringify(composition.parts ?? []);
        },
      };
    },
  },
  plain(
    "weight",
    (row) => row.weight,
    (extracted) => extracted.weight,
    (patch, weight) => {
      patch.weight = weight;
    },
  ),
  plain(
    "fabric",
    (row) => row.fabric,
    (extracted) => extracted.fabric,
    (patch, fabric) => {
      patch.fabric = fabric;
    },
  ),
  flag("windResistant"),
  flag("waterResistant"),
  plain(
    "categoryHint",
    (row) => row.categoryHint,
    (extracted) => asCategory(extracted.categoryHint),
    (patch, category) => {
      patch.categoryHint = category;
    },
  ),
];

export interface ApplyReport {
  filled: string[];
  refreshed: string[];
  kept: string[];
}

/**
 * The case table above, one row of it — answered as the report bucket the
 * column lands in, so the answer is observable rather than an intermediate
 * word that two buckets could share.
 */
function verdictFor(
  current: Cell | null,
  written: Cell | undefined,
  incoming: Cell,
): keyof ApplyReport | undefined {
  if (current === null) return written === undefined ? "filled" : "kept";
  if (current !== written) return "kept";
  return incoming === current ? undefined : "refreshed";
}

/**
Thrown when the row changed under us; the job is safe to run again.
*/
export class ExtractionConflictError extends Error {
  constructor(productId: string) {
    super(`Product ${productId} changed while extraction was being applied`);
    this.name = "ExtractionConflictError";
  }
}

/**
 * What enrichment last wrote to each column — the only part of the ledger
 * the read side needs. A row with no ledger has had nothing written to it.
 */
function lastWritten(row: ProductRow): Ledger["written"] {
  if (row.extracted === null) return {};
  // Both parses throw on purpose — see `ledgerSchema`.
  const stored: unknown = JSON.parse(row.extracted);
  return ledgerSchema.parse(stored).written;
}

export async function applyExtraction(
  db: Db,
  productId: string,
  extracted: ExtractedProduct,
  rung: Rung,
): Promise<ApplyReport> {
  const [row] = await db
    .select()
    .from(products)
    .where(eq(products.id, productId))
    .limit(1);
  if (row === undefined) throw new Error(`Product ${productId} not found`);

  const previous = lastWritten(row);
  const written: Record<string, Cell> = { ...previous };
  const patch: Patch = {};
  const report: ApplyReport = { filled: [], refreshed: [], kept: [] };

  for (const column of COLUMNS) {
    const found = column.find(extracted);
    if (found === undefined) continue;
    const verdict = verdictFor(
      column.current(row),
      previous[column.field],
      found.cell,
    );
    if (verdict === undefined) continue;
    report[verdict].push(column.field);
    if (verdict === "kept") continue;
    found.write(patch);
    written[column.field] = found.cell;
  }

  const next: Ledger = { rung, found: extracted, written };
  const guard =
    row.extracted === null
      ? isNull(products.extracted)
      : eq(products.extracted, row.extracted);
  const updated = await db
    .update(products)
    .set({ ...patch, extracted: JSON.stringify(next), extractionStatus: "done" })
    .where(and(eq(products.id, productId), guard))
    .returning({ id: products.id });
  if (updated.length === 0) throw new ExtractionConflictError(productId);

  return report;
}
