/**
 * The closet: garment CRUD on category × layer, filters, and the read-side
 * stats (temp band, performance, pairs-with) that drive screens C and F.
 *
 * Feed (lane 104) isn't merged, so performance/mileage/pairs-with are
 * computed here directly from `outfit_entries` / `outfit_entry_items` /
 * `runs`, always scoped by `outfit_entries.user_id` first so every scan
 * lands on the `entries_user_created` covering index (docs/contracts.md) —
 * never a scan keyed by `item_id` (no index backs that; see the design doc's
 * open questions for the proposal).
 *
 * Convention: nothing here writes the `null` literal (project lint rule).
 * TS-side "no value" is always `undefined`; where a drizzle `.values()`/
 * `.set()` call needs to actually clear a nullable column, `sql\`NULL\``
 * (raw SQL, not the JS keyword) does it — see `orSqlNull`/`boolToSqlValue`.
 */
import { and, eq, inArray, sql } from "drizzle-orm";
import type { SQL } from "drizzle-orm";
import type { SQLiteUpdateSetSource } from "drizzle-orm/sqlite-core";
import type { drizzle } from "drizzle-orm/d1";
import type { z } from "zod";

import {
  outfitEntries,
  outfitEntryItems,
  runs,
  wardrobeItems,
} from "../../db/schema-core";
import type {
  fabricSchema,
  Garment,
  layerSchema,
  PerformanceBucket,
  UiGroup,
  weightSchema,
} from "../../lib/contracts";
import { garmentSchema, uiGroupFor } from "../../lib/contracts";
import { garmentTypesFor } from "../../lib/garment-fields";
import { newUlid } from "../../lib/ids";
import { topByCount } from "../../lib/top-by-count";
import type { TempRange } from "../../lib/thermal";
import { estimateTempRange } from "../../lib/thermal";
import {
  getProductAttributeDefaults,
  getProductAttributeDefaultsBulk,
  resolveProduct,
} from "../products";
import type { ProductAttributeDefaults } from "../products";
import { ownedBy } from "../../lib/owned";

type Db = ReturnType<typeof drizzle>;
type Layer = z.infer<typeof layerSchema>;
type Weight = z.infer<typeof weightSchema>;
type Fabric = z.infer<typeof fabricSchema>;
export type WardrobeItemRow = typeof wardrobeItems.$inferSelect;
export type ItemOrigin = WardrobeItemRow["origin"];

const RETIRE_CANDIDATE_DAYS = 180;
const SECONDS_PER_DAY = 86_400;
const RETIRE_CANDIDATE_S = RETIRE_CANDIDATE_DAYS * SECONDS_PER_DAY;

export class NotFoundError extends Error {
  constructor() {
    super("Item not found.");
  }
}

/**
 * Column value that clears a nullable column without the `null` literal.
 */
function orSqlNull<T>(value: T | undefined): T | SQL {
  return value ?? sql`NULL`;
}

/**
 * Writes a real SQL NULL for "not stated", which is distinct from false —
 * an unstated flag is what lets a product default fill the gap, so drizzle
 * dropping an `undefined` set-value would silently mean "leave as-is".
 *
 * The 0/1 conversion this used to do is now the column's own codec
 * (mode:"boolean"), so this only handles the null case.
 */
function boolToSqlValue(value: boolean | undefined): boolean | SQL {
  return value ?? sql`NULL`;
}

/**
Null means "not stated"; the column already reads as a boolean otherwise.
*/
export function statedFlag(value: boolean | null): boolean | undefined {
  return value ?? undefined;
}

// ---- Attribute normalization (discriminated union -> flat nullable row) ---

interface NormalizedAttributes {
  layer: Layer | undefined;
  weight: Weight | undefined;
  fabric: Fabric | undefined;
  windResistant: boolean | undefined;
  waterResistant: boolean | undefined;
}

/**
 * Flattens the union to the row shape. `in` narrowing rather than an
 * exhaustive switch over all eight categories: the switch was correct, and
 * the compiler did catch a *new category*, but it silently ignored a new
 * *attribute* — nothing forced a fresh field on an existing variant to be
 * read here. This reads whatever the parsed variant actually carries, so
 * both kinds of change are covered.
 */
function normalizeAttributes(garment: Garment): NormalizedAttributes {
  return {
    layer: "layer" in garment ? garment.layer : undefined,
    weight: "weight" in garment ? garment.weight : undefined,
    fabric: "fabric" in garment ? garment.fabric : undefined,
    windResistant:
      "windResistant" in garment ? garment.windResistant : undefined,
    waterResistant:
      "waterResistant" in garment ? garment.waterResistant : undefined,
  };
}

function estimateForGarment(
  garment: Garment,
  normalized: NormalizedAttributes,
): TempRange | undefined {
  if (garment.estTempLowC !== undefined && garment.estTempHighC !== undefined) {
    return { lowC: garment.estTempLowC, highC: garment.estTempHighC };
  }
  return estimateTempRange({
    category: garment.category,
    layer: normalized.layer,
    weight: normalized.weight,
    windResistant: normalized.windResistant,
  });
}

/** Shared insert/update column values — every write path builds the row
 * exactly the same way from a validated Garment. */
function garmentRowValues(garment: Garment) {
  const normalized = normalizeAttributes(garment);
  const estRange = estimateForGarment(garment, normalized);
  return {
    category: garment.category,
    // Not in normalizeAttributes: that flattens attributes that only *some*
    // variants declare, and every variant declares `type`.
    type: orSqlNull(garment.type),
    layer: orSqlNull(normalized.layer),
    weight: orSqlNull(normalized.weight),
    fabric: orSqlNull(normalized.fabric),
    windResistant: boolToSqlValue(normalized.windResistant),
    waterResistant: boolToSqlValue(normalized.waterResistant),
    estTempLowC: orSqlNull(estRange?.lowC),
    estTempHighC: orSqlNull(estRange?.highC),
    brand: orSqlNull(garment.brand),
    name: garment.name,
    size: orSqlNull(garment.size),
    color: orSqlNull(garment.color),
    productUrl: orSqlNull(garment.productUrl),
    productId: orSqlNull(garment.productId),
  };
}

// ---- CRUD -------------------------------------------------------------

export async function getOwnedItem(
  db: Db,
  userId: string,
  itemId: string,
): Promise<WardrobeItemRow> {
  const [row] = await db
    .select()
    .from(wardrobeItems)
    .where(ownedBy(wardrobeItems, { id: itemId, userId }))
    .limit(1);
  if (!row) throw new NotFoundError();
  return row;
}

export async function createItem(
  db: Db,
  userId: string,
  garment: Garment,
  origin: ItemOrigin = "manual",
  idempotencyKey?: string,
): Promise<WardrobeItemRow> {
  // Add-a-piece is the highest-traffic form in the product, and a
  // double-click, a browser POST replay and a retry over a flaky
  // connection are indistinguishable from someone genuinely adding two of
  // the same shirt (law 8b). Resubmitting a key we already have returns
  // the row it made, so a retry looks like the success it is.
  if (idempotencyKey !== undefined) {
    const [existing] = await db
      .select()
      .from(wardrobeItems)
      .where(
        and(
          eq(wardrobeItems.userId, userId),
          eq(wardrobeItems.idempotencyKey, idempotencyKey),
        ),
      )
      .limit(1);
    if (existing !== undefined) return existing;
  }
  const id = newUlid();
  await db.insert(wardrobeItems).values({
    id,
    userId,
    ...garmentRowValues(garment),
    origin,
    idempotencyKey,
    retired: false,
    visibility: "ok",
    createdAt: Math.floor(Date.now() / 1000),
  });
  return getOwnedItem(db, userId, id);
}

/**
 * The ownership predicate, once. It was written out at six call sites; a
 * single one of them forgetting the `userId` clause is a cross-account
 * write, so it is not a phrase worth retyping.
 */
/**
 * Equivalent mutant either way: `inArray` would not match a null, so the
 * defaults come back the same with or without this. Dropping the nulls is
 * what keeps the `IN` list the size of the real work.
 */
function isLinked(productId: string | null): productId is string {
  // Stryker disable next-line ConditionalExpression
  return productId !== null;
}

function ownedItemWhere(userId: string, itemId: string) {
  return ownedBy(wardrobeItems, { id: itemId, userId });
}

/**
 * Every owner-scoped mutation is the same three steps — prove ownership,
 * apply, re-read — differing only in what gets set. updateItem, retireItem
 * and unretireItem were three copies of it.
 */
async function updateOwnedItem(
  db: Db,
  userId: string,
  itemId: string,
  values: SQLiteUpdateSetSource<typeof wardrobeItems>,
): Promise<WardrobeItemRow> {
  await getOwnedItem(db, userId, itemId);
  await db
    .update(wardrobeItems)
    .set(values)
    .where(ownedItemWhere(userId, itemId));
  return getOwnedItem(db, userId, itemId);
}

export async function updateItem(
  db: Db,
  userId: string,
  itemId: string,
  garment: Garment,
): Promise<WardrobeItemRow> {
  return updateOwnedItem(db, userId, itemId, garmentRowValues(garment));
}

export async function retireItem(
  db: Db,
  userId: string,
  itemId: string,
): Promise<WardrobeItemRow> {
  return updateOwnedItem(db, userId, itemId, { retired: true });
}

export async function unretireItem(
  db: Db,
  userId: string,
  itemId: string,
): Promise<WardrobeItemRow> {
  return updateOwnedItem(db, userId, itemId, { retired: false });
}

export interface DeleteOutcome {
  action: "deleted" | "retired";
}

/**
 * Retire, don't delete (CLAUDE.md product rule): an item referenced by any
 * outfit_entry_item can only be retired; an unreferenced item is hard-deleted.
 */
export async function deleteOrRetireItem(
  db: Db,
  userId: string,
  itemId: string,
): Promise<DeleteOutcome> {
  await getOwnedItem(db, userId, itemId);
  const [row] = await db
    .select({ count: sql<number>`count(*)` })
    .from(outfitEntryItems)
    .where(eq(outfitEntryItems.itemId, itemId));
  // Equivalent mutant on the optional chain: `count(*)` always answers with
  // exactly one row. It is here because `noUncheckedIndexedAccess` types
  // `rows[0]` as possibly absent, which is the compiler being right about
  // arrays rather than about this query.
  // Stryker disable next-line OptionalChaining
  const isReferenced = (row?.count ?? 0) > 0;
  if (isReferenced) {
    await db
      .update(wardrobeItems)
      .set({ retired: true })
      .where(ownedItemWhere(userId, itemId));
    return { action: "retired" };
  }
  await db
    .delete(wardrobeItems)
    .where(ownedItemWhere(userId, itemId));
  return { action: "deleted" };
}

// ---- UI groups -----------------------------------------------------------
//
// The group table moved to lib/contracts.ts: the feed's kit picker groups by
// the same table and had written its own copy.

// ---- Product-default merge (docs/contracts.md: garment columns override) --

export interface EffectiveAttributes {
  weight: Weight | undefined;
  fabric: Fabric | undefined;
  windResistant: boolean | undefined;
  waterResistant: boolean | undefined;
}

export function mergeWithProductDefaults(
  item: WardrobeItemRow,
  defaults: ProductAttributeDefaults | undefined,
): EffectiveAttributes {
  return {
    weight: item.weight ?? defaults?.weight ?? undefined,
    fabric: item.fabric ?? defaults?.fabric ?? undefined,
    windResistant: statedFlag(item.windResistant) ?? defaults?.windResistant,
    waterResistant: statedFlag(item.waterResistant) ?? defaults?.waterResistant,
  };
}

export function effectiveTempRange(
  item: WardrobeItemRow,
  effective: EffectiveAttributes,
): TempRange | undefined {
  if (item.estTempLowC !== null && item.estTempHighC !== null) {
    return { lowC: item.estTempLowC, highC: item.estTempHighC };
  }
  return estimateTempRange({
    category: item.category,
    layer: item.layer ?? undefined,
    weight: effective.weight,
    windResistant: effective.windResistant,
  });
}

// ---- Performance (D-27 filters; per-item verdict summary) ------------------



export interface PerformanceSummary {
  verdictCount: number;
  dialedCount: number;
  lastWornAt: number | undefined;
  mileageM: number;
}

export interface ItemPerformance {
  summary: PerformanceSummary;
  buckets: PerformanceBucket[];
  pairsWith: string[];
}

export function classifyPerformance(
  summary: PerformanceSummary,
  nowSeconds: number,
): PerformanceBucket[] {
  const buckets: PerformanceBucket[] = [];
  if (summary.verdictCount === 0) buckets.push("untested");
  if (
    summary.verdictCount >= 3 &&
    summary.dialedCount / summary.verdictCount >= 0.6
  ) {
    buckets.push("most_dialed");
  }
  if (summary.verdictCount >= 2 && summary.dialedCount === 0) {
    buckets.push("never_worked");
  }
  const { lastWornAt } = summary;
  // Equivalent mutant on the `undefined` check: an item that was never worn
  // gives `NaN` seconds, and `NaN > anything` is already false. It is here
  // so the line reads as arithmetic rather than as a comparison against a
  // missing value.
  // Stryker disable next-line ConditionalExpression
  if (lastWornAt !== undefined && nowSeconds - lastWornAt > RETIRE_CANDIDATE_S) {
    buckets.push("retire_candidate");
  }
  return buckets;
}

export interface EntryItemRow {
  entryId: string;
  itemId: string;
  createdAt: number;
  verdict: number | null;
  distanceM: number;
}

async function fetchUserEntryItemRows(
  db: Db,
  userId: string,
): Promise<EntryItemRow[]> {
  return db
    .select({
      entryId: outfitEntries.id,
      itemId: outfitEntryItems.itemId,
      createdAt: outfitEntries.createdAt,
      verdict: outfitEntries.verdict,
      distanceM: runs.distanceM,
    })
    .from(outfitEntries)
    .innerJoin(outfitEntryItems, eq(outfitEntryItems.entryId, outfitEntries.id))
    .innerJoin(runs, eq(runs.id, outfitEntries.runId))
    .where(eq(outfitEntries.userId, userId));
}

/** Groups the flat entry/item rows into per-item summaries and, alongside,
 * the per-entry item lists co-occurrence needs. */
export function summarizeByItem(rows: EntryItemRow[]): {
  summaries: Map<string, PerformanceSummary>;
  entryItems: Map<string, string[]>;
} {
  const summaries = new Map<string, PerformanceSummary>();
  const entryItems = new Map<string, string[]>();

  for (const row of rows) {
    const summary = summaries.get(row.itemId) ?? {
      verdictCount: 0,
      dialedCount: 0,
      lastWornAt: undefined,
      mileageM: 0,
    };
    if (row.verdict !== null) {
      summary.verdictCount += 1;
      if (row.verdict === 0) summary.dialedCount += 1;
    }
    summary.lastWornAt =
      summary.lastWornAt === undefined
        ? row.createdAt
        : Math.max(summary.lastWornAt, row.createdAt);
    summary.mileageM += row.distanceM;
    summaries.set(row.itemId, summary);

    const items = entryItems.get(row.entryId) ?? [];
    items.push(row.itemId);
    entryItems.set(row.entryId, items);
  }

  return { summaries, entryItems };
}

/** Co-occurrence counts per item, from the per-entry item lists. Isolated in
 * its own function so the inner pairwise loop's `continue` never nests
 * inside a caller's loop (unicorn/no-break-in-nested-loop). */
export function buildCoOccurrence(
  entryItems: Map<string, string[]>,
): Map<string, Map<string, number>> {
  const coOccurrence = new Map<string, Map<string, number>>();
  for (const itemIds of entryItems.values()) {
    addPairCounts(coOccurrence, itemIds);
  }
  return coOccurrence;
}

function addPairCounts(
  coOccurrence: Map<string, Map<string, number>>,
  itemIds: string[],
): void {
  for (const itemId of itemIds) {
    const others = itemIds.filter((otherId) => otherId !== itemId);
    for (const otherId of others) {
      const counts = coOccurrence.get(itemId) ?? new Map<string, number>();
      counts.set(otherId, (counts.get(otherId) ?? 0) + 1);
      coOccurrence.set(itemId, counts);
    }
  }
}

/**
 * Top `limit` co-occurring item ids by count. The selection itself is
 * `lib/top-by-count` — the profile's "most worn" is the same one, and both
 * had their own loop.
 */
export function topPairIds(counts: Map<string, number>, limit: number): string[] {
  return topByCount(counts, limit).map(([itemId]) => itemId);
}

const PAIRS_WITH_LIMIT = 2;

/**
 * One index-covered scan of the user's whole logging history, aggregated in
 * memory (small per-user scale at launch) into per-item verdict/mileage/
 * pairs-with stats. Reused by both the closet list (performance filter) and
 * garment detail (verdict summary + mileage + "pairs with").
 */
export async function computeUserPerformance(
  db: Db,
  userId: string,
): Promise<Map<string, ItemPerformance>> {
  const rows = await fetchUserEntryItemRows(db, userId);
  const { summaries, entryItems } = summarizeByItem(rows);
  const coOccurrence = buildCoOccurrence(entryItems);

  const nowSeconds = Math.floor(Date.now() / 1000);
  const result = new Map<string, ItemPerformance>();
  for (const [itemId, summary] of summaries) {
    const pairsWith = topPairIds(
      coOccurrence.get(itemId) ?? new Map<string, number>(),
      PAIRS_WITH_LIMIT,
    );
    result.set(itemId, {
      summary,
      buckets: classifyPerformance(summary, nowSeconds),
      pairsWith,
    });
  }
  return result;
}

// ---- Closet list (screen C) ------------------------------------------------

export interface ClosetFilters {
  category?: WardrobeItemRow["category"] | undefined;
  minTempC?: number | undefined;
  maxTempC?: number | undefined;
  windResistant?: boolean | undefined;
  waterResistant?: boolean | undefined;
  performance?: PerformanceBucket | undefined;
  includeRetired?: boolean | undefined;
}

export interface ClosetItemView {
  item: WardrobeItemRow;
  isGeneric: boolean;
  uiGroup: UiGroup;
  effective: EffectiveAttributes;
  tempRange: TempRange | undefined;
  performance: ItemPerformance | undefined;
}

export interface ClosetListing {
  items: ClosetItemView[];
  totalCount: number;
  genericCount: number;
}

export function shouldIncludeByConditionFilters(
  effective: EffectiveAttributes,
  filters: ClosetFilters,
): boolean {
  if (
    filters.windResistant !== undefined &&
    effective.windResistant !== filters.windResistant
  ) {
    return false;
  }
  return (
    filters.waterResistant === undefined ||
    effective.waterResistant === filters.waterResistant
  );
}

export function shouldIncludeByTempFilter(
  tempRange: TempRange | undefined,
  filters: ClosetFilters,
): boolean {
  if (filters.minTempC === undefined && filters.maxTempC === undefined) {
    return true;
  }
  if (!tempRange) return false;
  // Open ends as infinities rather than as `!== undefined` guards.
  //
  // "An open end always satisfies its side of the overlap" was written as a
  // comment above three `!== undefined` checks, and mutation testing showed
  // why that is not the same as saying it: `x < undefined` is already
  // false, so every one of those guards could be deleted without changing
  // an answer. They were load-bearing for the compiler and decorative at
  // runtime. Said this way it is one overlap test, and every part of it is
  // reachable.
  const askedFrom = filters.minTempC ?? -Infinity;
  const askedTo = filters.maxTempC ?? Infinity;
  const goodFrom = tempRange.lowC ?? -Infinity;
  const goodTo = tempRange.highC ?? Infinity;
  return goodTo >= askedFrom && goodFrom <= askedTo;
}

function toItemView(
  row: WardrobeItemRow,
  defaults: ProductAttributeDefaults | undefined,
  performance: ItemPerformance | undefined,
): ClosetItemView {
  const effective = mergeWithProductDefaults(row, defaults);
  return {
    item: row,
    isGeneric: row.productId === null,
    uiGroup: uiGroupFor(row.category, row.layer),
    effective,
    tempRange: effectiveTempRange(row, effective),
    performance,
  };
}

export function shouldIncludeByPerformanceFilter(
  view: ClosetItemView,
  filters: ClosetFilters,
): boolean {
  if (filters.performance === undefined) return true;
  const buckets = view.performance?.buckets ?? ["untested"];
  return buckets.includes(filters.performance);
}

export async function listItems(
  db: Db,
  userId: string,
  filters: ClosetFilters = {},
): Promise<ClosetListing> {
  const rows = await db
    .select()
    .from(wardrobeItems)
    .where(
      and(
        eq(wardrobeItems.userId, userId),
        filters.includeRetired ? undefined : eq(wardrobeItems.retired, false),
        filters.category
          ? eq(wardrobeItems.category, filters.category)
          : undefined,
      ),
    );

  // Stryker disable next-line MethodExpression
  const linkedProductIds = rows.map((row) => row.productId).filter(isLinked);
  const productIds = [...new Set(linkedProductIds)];
  const [defaultsByProduct, performanceByItem] = await Promise.all([
    getProductAttributeDefaultsBulk(db, productIds),
    computeUserPerformance(db, userId),
  ]);
  const genericCount = rows.filter((row) => row.productId === null).length;

  const views = rows
    .map((row) =>
      toItemView(
        row,
        // Equivalent mutant: `Map#get` of a null key answers undefined, so
        // both arms agree. The check says the intent — an unlinked item has
        // no defaults to look up — rather than relying on that.
        // Stryker disable next-line ConditionalExpression
        row.productId === null
          ? undefined
          : defaultsByProduct.get(row.productId),
        performanceByItem.get(row.id),
      ),
    )
    .filter(
      (view) =>
        shouldIncludeByConditionFilters(view.effective, filters) &&
        shouldIncludeByPerformanceFilter(view, filters) &&
        shouldIncludeByTempFilter(view.tempRange, filters),
    );

  return { items: views, totalCount: rows.length, genericCount };
}

export interface ItemDetail extends ClosetItemView {
  productDefaults: ProductAttributeDefaults | undefined;
}

export async function getItemDetail(
  db: Db,
  userId: string,
  itemId: string,
): Promise<ItemDetail> {
  const item = await getOwnedItem(db, userId, itemId);
  const [productDefaults, performanceByItem] = await Promise.all([
    // Equivalent mutant: looking a null product up answers undefined
    // anyway. The check says the intent — an unlinked item has no defaults
    // — and saves the query.
    // Stryker disable next-line ConditionalExpression
    item.productId === null
      ? Promise.resolve(undefined)
      : getProductAttributeDefaults(db, item.productId),
    computeUserPerformance(db, userId),
  ]);
  const view = toItemView(
    item,
    productDefaults,
    performanceByItem.get(item.id),
  );
  return { ...view, productDefaults };
}

/**
 * Cross-user pairs-with resolution (garment detail's "pairs with" chips need
 * the paired items' names, not just ids) — small, id-scoped lookup so it
 * never needs a wardrobe_items(id) index beyond the primary key.
 */
export async function getItemsByIds(
  db: Db,
  userId: string,
  itemIds: string[],
): Promise<WardrobeItemRow[]> {
  // Equivalent mutant: an empty `inArray` matches nothing, so the query
  // would answer with the same empty list. The return saves the query.
  // Stryker disable next-line ConditionalExpression
  if (itemIds.length === 0) return [];
  return db
    .select()
    .from(wardrobeItems)
    .where(
      and(eq(wardrobeItems.userId, userId), inArray(wardrobeItems.id, itemIds)),
    );
}

/**
 * Attaches a canonical product to a garment, at the write site.
 *
 * A garment is ideally a *product* — "Janji Rover Half-Zip", not "a long
 * sleeve" (D-27) — so a brand and a name together resolve (create-if-
 * missing) a product row, link `product_id`, and bring the product's type
 * with them. Design's Z screen: the type "came with the match, from the
 * product record — it was never a question".
 *
 * This ran in the browser first, once per route, which meant two round
 * trips and a rule a caller could simply not call. Here it runs wherever a
 * garment is written, so it cannot be skipped and the client is one
 * request lighter.
 *
 * The type is validated against the garment's category rather than
 * trusted: a product row could carry a type belonging to another category,
 * and the whole save would fail rather than a bad hint being ignored.
 */
export async function withResolvedProduct(
  db: Db,
  garment: Garment,
  createdBy: string,
): Promise<Garment> {
  const brand = garment.brand?.trim() ?? "";
  if (brand === "" || garment.name.trim() === "") return garment;
  const { product } = await resolveProduct(db, {
    brandName: brand,
    productName: garment.name,
    sourceUrl: garment.productUrl,
    createdBy,
  });
  const allowed: readonly string[] = garmentTypesFor(garment.category);
  // Equivalent mutant on the null check: `allowed.includes(null)` is already
  // false, so dropping it changes no answer. It is here because `includes`
  // takes a string.
  const inherited =
    // Stryker disable next-line ConditionalExpression
    product.type !== null && allowed.includes(product.type)
      ? product.type
      : undefined;
  return garmentSchema.parse({
    ...garment,
    productId: product.id,
    ...(inherited !== undefined && { type: inherited }),
  });
}
