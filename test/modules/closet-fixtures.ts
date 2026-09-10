import { z } from "zod";

import type {
  ClosetItemView,
  ClosetListing,
  WardrobeItemRow,
} from "../../src/modules/closet/service";

/**
 * Closet rows as plain data, for tests that render a component rather than
 * exercise a query.
 *
 * `test/closet/components.test.tsx` used to build these through `createItem`
 * against D1 — a component that needs a database to test is a smell, and it
 * was also the reason those tests could only live in the workers pool. The
 * reason it reached for a real row was narrower than it looked: drizzle
 * types every nullable column as `T | null`, and `unicorn/no-null` forbids
 * writing the literal. Parsing one, once, is enough.
 */
const NOTHING = z.null().parse(JSON.parse("null"));

export function wardrobeItem(
  overrides: Partial<WardrobeItemRow> = {},
): WardrobeItemRow {
  return {
    id: "01ITEM",
    userId: "01USER",
    category: "top",
    type: NOTHING,
    layer: NOTHING,
    weight: NOTHING,
    fabric: NOTHING,
    windResistant: NOTHING,
    waterResistant: NOTHING,
    estTempLowC: NOTHING,
    estTempHighC: NOTHING,
    brand: NOTHING,
    name: "Long sleeve top",
    size: NOTHING,
    color: NOTHING,
    photoKey: NOTHING,
    productUrl: NOTHING,
    productId: NOTHING,
    origin: "manual",
    idempotencyKey: NOTHING,
    retired: false,
    visibility: "public",
    createdAt: 1_755_000_000,
    ...overrides,
  };
}

export function itemView(
  overrides: Partial<ClosetItemView> = {},
): ClosetItemView {
  return {
    item: wardrobeItem(),
    isGeneric: true,
    uiGroup: "tops",
    effective: {
      weight: undefined,
      fabric: undefined,
      windResistant: undefined,
      waterResistant: undefined,
    },
    tempRange: undefined,
    performance: undefined,
    ...overrides,
  };
}

/**
Counts derived from the views, so a fixture cannot disagree with itself.
*/
export function listing(views: readonly ClosetItemView[]): ClosetListing {
  return {
    items: [...views],
    totalCount: views.length,
    genericCount: views.filter((view) => view.isGeneric).length,
  };
}
