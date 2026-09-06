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
  weightSchema,
} from "../../lib/contracts";
import { newUlid } from "../../lib/ids";
import type { TempRange } from "../../lib/thermal";
import { estimateTempRange } from "../../lib/thermal";
import {
  getProductAttributeDefaults,
  getProductAttributeDefaultsBulk,
} from "../products";
import type { ProductAttributeDefaults } from "../products";

type Db = ReturnType<typeof drizzle>;
type Layer = z.infer<typeof layerSchema>;
type Weight = z.infer<typeof weightSchema>;
type Fabric = z.infer<typeof fabricSchema>;
export type WardrobeItemRow = typeof wardrobeItems.$inferSelect;
export type ItemOrigin = WardrobeItemRow["origin"];

const RETIRE_CANDIDATE_DAYS = 180;
const SECONDS_PER_DAY = 86_400;

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

function boolToSqlValue(value: boolean | undefined): number | SQL {
  let intValue: number | undefined;
  if (value !== undefined) {
    intValue = value ? 1 : 0;
  }
  return intValue ?? sql`NULL`;
}

function intToBool(value: number | null): boolean | undefined {
  if (value === null) return undefined;
  return value === 1;
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
 * Exhaustive switch on `category` (never `in` narrowing, never a cast): each
 * branch only reads the fields that category's zod variant actually admits.
 */
function normalizeAttributes(garment: Garment): NormalizedAttributes {
  switch (garment.category) {
    case "top":
    case "bottom": {
      return {
        layer: garment.layer,
        weight: garment.weight,
        fabric: garment.fabric,
        windResistant: garment.windResistant,
        waterResistant: garment.waterResistant,
      };
    }
    case "headwear": {
      return {
        layer: undefined,
        weight: garment.weight,
        fabric: garment.fabric,
        windResistant: garment.windResistant,
        waterResistant: undefined,
      };
    }
    case "neckwear":
    case "socks": {
      return {
        layer: undefined,
        weight: garment.weight,
        fabric: garment.fabric,
        windResistant: undefined,
        waterResistant: undefined,
      };
    }
    case "gloves": {
      return {
        layer: undefined,
        weight: garment.weight,
        fabric: undefined,
        windResistant: garment.windResistant,
        waterResistant: garment.waterResistant,
      };
    }
    case "shoes": {
      return {
        layer: undefined,
        weight: undefined,
        fabric: undefined,
        windResistant: undefined,
        waterResistant: garment.waterResistant,
      };
    }
    case "accessory": {
      return {
        layer: undefined,
        weight: undefined,
        fabric: undefined,
        windResistant: undefined,
        waterResistant: undefined,
      };
    }
  }
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
    .where(and(eq(wardrobeItems.id, itemId), eq(wardrobeItems.userId, userId)))
    .limit(1);
  if (!row) throw new NotFoundError();
  return row;
}

export async function createItem(
  db: Db,
  userId: string,
  garment: Garment,
  origin: ItemOrigin = "manual",
): Promise<WardrobeItemRow> {
  const id = newUlid();
  await db.insert(wardrobeItems).values({
    id,
    userId,
    ...garmentRowValues(garment),
    origin,
    retired: 0,
    visibility: "ok",
    createdAt: Math.floor(Date.now() / 1000),
  });
  return getOwnedItem(db, userId, id);
}

export async function updateItem(
  db: Db,
  userId: string,
  itemId: string,
  garment: Garment,
): Promise<WardrobeItemRow> {
  await getOwnedItem(db, userId, itemId);
  await db
    .update(wardrobeItems)
    .set(garmentRowValues(garment))
    .where(and(eq(wardrobeItems.id, itemId), eq(wardrobeItems.userId, userId)));
  return getOwnedItem(db, userId, itemId);
}

export async function retireItem(
  db: Db,
  userId: string,
  itemId: string,
): Promise<WardrobeItemRow> {
  await getOwnedItem(db, userId, itemId);
  await db
    .update(wardrobeItems)
    .set({ retired: 1 })
    .where(and(eq(wardrobeItems.id, itemId), eq(wardrobeItems.userId, userId)));
  return getOwnedItem(db, userId, itemId);
}

export async function unretireItem(
  db: Db,
  userId: string,
  itemId: string,
): Promise<WardrobeItemRow> {
  await getOwnedItem(db, userId, itemId);
  await db
    .update(wardrobeItems)
    .set({ retired: 0 })
    .where(and(eq(wardrobeItems.id, itemId), eq(wardrobeItems.userId, userId)));
  return getOwnedItem(db, userId, itemId);
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
  const isReferenced = (row?.count ?? 0) > 0;
  if (isReferenced) {
    await db
      .update(wardrobeItems)
      .set({ retired: 1 })
      .where(
        and(eq(wardrobeItems.id, itemId), eq(wardrobeItems.userId, userId)),
      );
    return { action: "retired" };
  }
  await db
    .delete(wardrobeItems)
    .where(and(eq(wardrobeItems.id, itemId), eq(wardrobeItems.userId, userId)));
  return { action: "deleted" };
}

// ---- UI groups (docs/contracts.md derived-group table) --------------------

export type UiGroup =
  "tops" | "bottoms" | "outer" | "hands_head" | "shoes" | "socks_extras";

export function computeUiGroup(item: {
  category: WardrobeItemRow["category"];
  layer: WardrobeItemRow["layer"];
}): UiGroup {
  if (item.layer === "outer") return "outer";
  switch (item.category) {
    case "top": {
      return "tops";
    }
    case "bottom": {
      return "bottoms";
    }
    case "headwear":
    case "neckwear":
    case "gloves": {
      return "hands_head";
    }
    case "shoes": {
      return "shoes";
    }
    case "socks":
    case "accessory": {
      return "socks_extras";
    }
  }
}

// ---- Product-default merge (docs/contracts.md: garment columns override) --

export interface EffectiveAttributes {
  weight: Weight | undefined;
  fabric: Fabric | undefined;
  windResistant: boolean | undefined;
  waterResistant: boolean | undefined;
}

function mergeWithProductDefaults(
  item: WardrobeItemRow,
  defaults: ProductAttributeDefaults | undefined,
): EffectiveAttributes {
  return {
    weight: item.weight ?? defaults?.weight ?? undefined,
    fabric: item.fabric ?? defaults?.fabric ?? undefined,
    windResistant: intToBool(item.windResistant) ?? defaults?.windResistant,
    waterResistant: intToBool(item.waterResistant) ?? defaults?.waterResistant,
  };
}

function effectiveTempRange(
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

export type PerformanceBucket =
  "most_dialed" | "never_worked" | "untested" | "retire_candidate";

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

function classifyPerformance(
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
  const daysSinceWorn =
    summary.lastWornAt === undefined
      ? undefined
      : (nowSeconds - summary.lastWornAt) / SECONDS_PER_DAY;
  if (daysSinceWorn !== undefined && daysSinceWorn > RETIRE_CANDIDATE_DAYS) {
    buckets.push("retire_candidate");
  }
  return buckets;
}

interface EntryItemRow {
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
function summarizeByItem(rows: EntryItemRow[]): {
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
function buildCoOccurrence(
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
 * The highest-count entry remaining, removed from the map as it's taken.
 */
function popMax(remaining: Map<string, number>): string | undefined {
  let bestId: string | undefined;
  let bestCount = -1;
  for (const [id, count] of remaining) {
    if (count <= bestCount) continue;
    bestCount = count;
    bestId = id;
  }
  if (bestId !== undefined) remaining.delete(bestId);
  return bestId;
}

/**
 * Top `limit` co-occurring item ids by count, without Array#sort (project
 * lint prefers Array#toSorted, which needs an ES2023 lib not enabled here;
 * a bounded selection avoids the question entirely — limit is always 2).
 */
function topPairIds(counts: Map<string, number>, limit: number): string[] {
  const remaining = new Map(counts);
  const result: string[] = [];
  for (let index = 0; index < limit; index += 1) {
    const bestId = popMax(remaining);
    if (bestId === undefined) break;
    result.push(bestId);
  }
  return result;
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

function shouldIncludeByConditionFilters(
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

function shouldIncludeByTempFilter(
  tempRange: TempRange | undefined,
  filters: ClosetFilters,
): boolean {
  if (filters.minTempC === undefined && filters.maxTempC === undefined) {
    return true;
  }
  if (!tempRange) return false;
  if (filters.minTempC !== undefined && tempRange.highC < filters.minTempC) {
    return false;
  }
  return filters.maxTempC === undefined || tempRange.lowC <= filters.maxTempC;
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
    uiGroup: computeUiGroup(row),
    effective,
    tempRange: effectiveTempRange(row, effective),
    performance,
  };
}

function shouldIncludeByPerformanceFilter(
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
        filters.includeRetired ? undefined : eq(wardrobeItems.retired, 0),
        filters.category
          ? eq(wardrobeItems.category, filters.category)
          : undefined,
      ),
    );

  const productIds = [
    ...new Set(
      rows
        .map((row) => row.productId)
        .filter((id): id is string => id !== null),
    ),
  ];
  const [defaultsByProduct, performanceByItem] = await Promise.all([
    getProductAttributeDefaultsBulk(db, productIds),
    computeUserPerformance(db, userId),
  ]);
  const genericCount = rows.filter((row) => row.productId === null).length;

  const views = rows
    .map((row) =>
      toItemView(
        row,
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
  if (itemIds.length === 0) return [];
  return db
    .select()
    .from(wardrobeItems)
    .where(
      and(eq(wardrobeItems.userId, userId), inArray(wardrobeItems.id, itemIds)),
    );
}
