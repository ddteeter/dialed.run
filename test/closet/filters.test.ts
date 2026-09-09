import { drizzle } from "drizzle-orm/d1";
import { describe, expect, it } from "vitest";
import { z } from "zod";

import type { TempRange } from "../../src/lib/thermal";
import { env } from "../../src/env";
import { newUlid } from "../../src/lib/ids";
import {
  createItem,
  mergeWithProductDefaults,
  shouldIncludeByConditionFilters,
  shouldIncludeByTempFilter,
  statedFlag,
  type ClosetFilters,
  type EffectiveAttributes,
} from "../../src/modules/closet/service";

/**
 * The closet list's filters, which decide what a runner is shown and — more
 * to the point — what they are not.
 *
 * Fifty-one mutants lived in these three functions, reachable only through
 * `listItems` against a seeded database, so the tests exercised a filter or
 * two and none of the boundaries. Every one of them fails the same way: the
 * screen looks fine and half the closet is missing.
 */

const NOTHING_STATED: EffectiveAttributes = {
  weight: undefined,
  fabric: undefined,
  windResistant: undefined,
  waterResistant: undefined,
};

function attributes(
  overrides: Partial<EffectiveAttributes> = {},
): EffectiveAttributes {
  return { ...NOTHING_STATED, ...overrides };
}

function filters(overrides: ClosetFilters = {}): ClosetFilters {
  return overrides;
}

describe("statedFlag", () => {
  it("keeps false as an answer and null as no answer", () => {
    // The whole reason the column is nullable: "this does not block wind"
    // is a fact a runner entered, and "nobody said" is not.
    expect(statedFlag(true)).toBe(true);
    expect(statedFlag(false)).toBe(false);
    expect(statedFlag(statedNull())).toBeUndefined();
  });
});

/**
The nullable column's empty value, parsed rather than written as a literal.
*/
function statedNull(): boolean | null {
  return z.null().parse(JSON.parse("null"));
}

describe("shouldIncludeByConditionFilters", () => {
  it("includes everything when no condition filter is set", () => {
    // Including items that *do* state a flag: with no filter asked for,
    // the stated value is not a reason to hide anything.
    expect(shouldIncludeByConditionFilters(attributes(), filters())).toBe(true);
    expect(
      shouldIncludeByConditionFilters(
        attributes({ windResistant: true, waterResistant: true }),
        filters(),
      ),
    ).toBe(true);
  });

  it("matches a wind filter exactly, in both directions", () => {
    expect(
      shouldIncludeByConditionFilters(
        attributes({ windResistant: true }),
        filters({ windResistant: true }),
      ),
    ).toBe(true);
    expect(
      shouldIncludeByConditionFilters(
        attributes({ windResistant: false }),
        filters({ windResistant: true }),
      ),
    ).toBe(false);
    // "Show me things that do not block wind" is a real query, and an item
    // nobody has said anything about is not an answer to it.
    expect(
      shouldIncludeByConditionFilters(
        attributes({ windResistant: false }),
        filters({ windResistant: false }),
      ),
    ).toBe(true);
    expect(
      shouldIncludeByConditionFilters(
        attributes(),
        filters({ windResistant: false }),
      ),
    ).toBe(false);
  });

  it("matches a water filter the same way", () => {
    expect(
      shouldIncludeByConditionFilters(
        attributes({ waterResistant: true }),
        filters({ waterResistant: true }),
      ),
    ).toBe(true);
    expect(
      shouldIncludeByConditionFilters(
        attributes({ waterResistant: false }),
        filters({ waterResistant: true }),
      ),
    ).toBe(false);
  });

  it("applies both filters, not whichever it checks first", () => {
    // Two independent conditions: an item that passes one and fails the
    // other is out.
    expect(
      shouldIncludeByConditionFilters(
        attributes({ windResistant: true, waterResistant: false }),
        filters({ windResistant: true, waterResistant: true }),
      ),
    ).toBe(false);
  });
});

function range(lowC: number, highC: number): TempRange {
  return { lowC, highC };
}

describe("shouldIncludeByTempFilter", () => {
  it("includes everything when neither end is asked for", () => {
    expect(shouldIncludeByTempFilter(undefined, filters())).toBe(true);
  });

  it("excludes an item with no estimate once either end is asked for", () => {
    // A garment nothing can place on a temperature scale cannot answer a
    // temperature question, and guessing it in would be worse than
    // leaving it out.
    expect(
      shouldIncludeByTempFilter(undefined, filters({ minTempC: 0 })),
    ).toBe(false);
    expect(
      shouldIncludeByTempFilter(undefined, filters({ maxTempC: 20 })),
    ).toBe(false);
  });

  it("keeps a range that reaches the asked-for minimum", () => {
    // Overlap, not containment: a garment good to 5 is an answer to "show
    // me things for 5 and up".
    expect(
      shouldIncludeByTempFilter(range(-5, 5), filters({ minTempC: 5 })),
    ).toBe(true);
    expect(
      shouldIncludeByTempFilter(range(-5, 4), filters({ minTempC: 5 })),
    ).toBe(false);
  });

  it("keeps a range that reaches the asked-for maximum", () => {
    expect(
      shouldIncludeByTempFilter(range(15, 30), filters({ maxTempC: 15 })),
    ).toBe(true);
    expect(
      shouldIncludeByTempFilter(range(16, 30), filters({ maxTempC: 15 })),
    ).toBe(false);
  });

  it("applies both ends, not whichever it checks first", () => {
    expect(
      shouldIncludeByTempFilter(
        range(20, 30),
        filters({ minTempC: 0, maxTempC: 10 }),
      ),
    ).toBe(false);
    expect(
      shouldIncludeByTempFilter(
        range(0, 10),
        filters({ minTempC: 0, maxTempC: 10 }),
      ),
    ).toBe(true);
  });

  it("treats an open end as satisfying its side", () => {
    // A garment with no upper bound is appropriate however warm the filter
    // asks for — the comment in the source says so, and nothing checked it.
    expect(
      shouldIncludeByTempFilter(
        { lowC: -20 },
        filters({ minTempC: 40 }),
      ),
    ).toBe(true);
    expect(
      shouldIncludeByTempFilter(
        { highC: 5 },
        filters({ maxTempC: -30 }),
      ),
    ).toBe(true);
  });
});

/**
 * A stored row, written through `createItem` — a literal would need a cast,
 * and the cast is what lets a fixture drift from the schema.
 */
function itemWith(
  attributes: { weight?: "light" | "mid" | "heavy"; windResistant?: boolean } = {},
): ReturnType<typeof createItem> {
  return createItem(
    drizzle(env.DIALED_CORE),
    newUlid(),
    { category: "top", name: "Merge test shirt", ...attributes },
    "manual",
  );
}

const PRODUCT_DEFAULTS = {
  weight: "light",
  fabric: "merino",
  windResistant: false,
  waterResistant: true,
  // Nullable on the product row; parsed rather than written as a literal.
  categoryHint: z.null().parse(JSON.parse("null")),
} as const;

describe("mergeWithProductDefaults", () => {
  it("lets the item's own columns win", async () => {
    const merged = mergeWithProductDefaults(
      await itemWith({ weight: "heavy", windResistant: true }),
      PRODUCT_DEFAULTS,
    );
    expect(merged.weight).toBe("heavy");
    expect(merged.windResistant).toBe(true);
  });

  it("falls back to the product where the item says nothing", async () => {
    const merged = mergeWithProductDefaults(await itemWith({}), PRODUCT_DEFAULTS);
    expect(merged.weight).toBe("light");
    expect(merged.fabric).toBe("merino");
    // The one that matters: the product said `false`, and `false` is an
    // answer. Collapsing it to "nothing said" loses it.
    expect(merged.windResistant).toBe(false);
    expect(merged.waterResistant).toBe(true);
  });

  it("says nothing when neither does", async () => {
    expect(
      mergeWithProductDefaults(await itemWith({}), undefined),
    ).toStrictEqual(NOTHING_STATED);
  });
});
