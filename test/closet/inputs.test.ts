import { describe, expect, it } from "vitest";

import { garmentCategories } from "../../src/lib/contracts";
import { newUlid } from "../../src/lib/ids";
import {
  closetFiltersInput,
  closetSearch,
  itemIdInput,
  newItemInput,
  requireFormData,
  updateItemInput,
} from "../../src/modules/closet/inputs";

/**
 * The closet server functions' input contracts.
 *
 * They lived in `functions.ts`, which cannot be imported by a test at all
 * (R-41) — so the filter set every closet read is parsed against, and the
 * idempotency key that stops a double-tap creating two garments, had no
 * coverage of any kind.
 */

describe("closetFiltersInput", () => {
  it("takes no filters at all", () => {
    // The unfiltered closet is the common case, and the server function
    // parses `data ?? {}` into this.
    expect(closetFiltersInput.safeParse({}).success).toBe(true);
  });

  it("admits every garment category, and nothing else", () => {
    // Derived from `garmentCategories` rather than listed again: the list
    // was written out twice and the copy was free to fall behind.
    for (const category of garmentCategories) {
      expect(closetFiltersInput.safeParse({ category }).success, category).toBe(
        true,
      );
    }
    expect(closetFiltersInput.safeParse({ category: "hat" }).success).toBe(
      false,
    );
  });

  it("takes temperatures as numbers, including negative ones", () => {
    // Half the point of the filter is finding cold-weather gear.
    expect(
      closetFiltersInput.safeParse({ minTempC: -15, maxTempC: 5 }).success,
    ).toBe(true);
    expect(closetFiltersInput.safeParse({ minTempC: "-15" }).success).toBe(
      false,
    );
  });

  it("takes the condition flags as booleans", () => {
    expect(closetFiltersInput.safeParse({ windResistant: false }).success).toBe(
      true,
    );
    expect(
      closetFiltersInput.safeParse({ waterResistant: "yes" }).success,
    ).toBe(false);
  });

  it("takes a performance bucket the closet knows", () => {
    expect(
      closetFiltersInput.safeParse({ performance: "untested" }).success,
    ).toBe(true);
    expect(
      closetFiltersInput.safeParse({ performance: "favourite" }).success,
    ).toBe(false);
  });
});

describe("itemIdInput", () => {
  it("needs a ULID, not any string", () => {
    // Every owner-scoped read and write takes its id through this.
    expect(itemIdInput.safeParse({ itemId: newUlid() }).success).toBe(true);
    expect(itemIdInput.safeParse({ itemId: "12" }).success).toBe(false);
    expect(itemIdInput.safeParse({}).success).toBe(false);
  });
});

describe("newItemInput", () => {
  const garment = { category: "top", name: "Rover Half-Zip" };

  it("needs a garment, and takes an idempotency key with it", () => {
    expect(newItemInput.safeParse({ garment }).success).toBe(true);
    expect(
      newItemInput.safeParse({ garment, idempotencyKey: newUlid() }).success,
    ).toBe(true);
    expect(newItemInput.safeParse({}).success).toBe(false);
  });

  it("refuses a key that is not a ULID", () => {
    // The key is minted client-side and backed by a UNIQUE index scoped to
    // the user (law 8b); a free-form string there is a collision waiting.
    expect(
      newItemInput.safeParse({ garment, idempotencyKey: "retry-1" }).success,
    ).toBe(false);
  });

  it("still parses the garment through the contract", () => {
    expect(
      newItemInput.safeParse({ garment: { category: "top" } }).success,
    ).toBe(false);
  });
});

describe("updateItemInput", () => {
  it("needs both the item and the garment to replace it with", () => {
    const garment = { category: "top", name: "Edited" };
    expect(
      updateItemInput.safeParse({ itemId: newUlid(), garment }).success,
    ).toBe(true);
    expect(updateItemInput.safeParse({ garment }).success).toBe(false);
    expect(updateItemInput.safeParse({ itemId: newUlid() }).success).toBe(
      false,
    );
  });
});

describe("requireFormData", () => {
  it("hands a multipart body straight through", () => {
    const form = new FormData();
    form.set("itemId", "x");
    expect(requireFormData(form)).toBe(form);
  });

  it("refuses anything else", () => {
    // A JSON body posted at the photo endpoint is a client bug, and it has
    // to fail as one rather than as a null dereference further in.
    expect(() => requireFormData({ itemId: "x" })).toThrow(TypeError);
    expect(() => requireFormData(undefined)).toThrow(/multipart/);
  });
});

describe("closetSearch", () => {
  it("keeps retired=true", () => {
    expect(closetSearch({ retired: true })).toStrictEqual({ retired: true });
  });

  it("drops anything else rather than refusing the page", () => {
    expect(closetSearch({})).toStrictEqual({});
    expect(closetSearch({ retired: "true" })).toStrictEqual({});
    expect(closetSearch({ retired: false })).toStrictEqual({});
  });

  it("keeps the rail's group and coverage, and only their own values", () => {
    expect(closetSearch({ group: "hands_head" })).toStrictEqual({
      group: "hands_head",
    });
    expect(closetSearch({ coverage: "partial" })).toStrictEqual({
      coverage: "partial",
    });
    expect(closetSearch({ group: "hats", coverage: "most" })).toStrictEqual({});
    // What an empty hidden input sends from the form before hydration.
    expect(closetSearch({ group: "", coverage: "" })).toStrictEqual({});
  });

  it("keeps WORKS AT in Celsius, whatever the unit says about the form", () => {
    expect(closetSearch({ from: 1.1, to: 14.4 })).toStrictEqual({
      from: 1.1,
      to: 14.4,
    });
    expect(closetSearch({ from: -5 })).toStrictEqual({ from: -5 });
    expect(closetSearch({ to: 20 })).toStrictEqual({ to: 20 });
    // `unit` is the form's, and says nothing about `from` and `to`.
    expect(closetSearch({ from: 4, to: 12, unit: "f" })).toStrictEqual({
      from: 4,
      to: 12,
    });
  });

  it("converts what the form typed in its unit, and keeps none of the form's fields", () => {
    expect(closetSearch({ lowest: 34, highest: 58, unit: "f" })).toStrictEqual({
      from: 1.1,
      to: 14.4,
    });
    expect(closetSearch({ lowest: 4, unit: "c" })).toStrictEqual({ from: 4 });
  });

  it("prefers what the form typed over a span the search already held", () => {
    expect(
      closetSearch({ lowest: 34, from: 20, highest: 58, to: 30, unit: "f" }),
    ).toStrictEqual({ from: 1.1, to: 14.4 });
  });

  // The router runs it again over a search that still holds the raw
  // fields beside what it made. Converting its own output again walked
  // 60–80°F down to −40°, where the scales meet (design 174).
  it("gives the same answer run again over its own output and the raw fields", () => {
    const raw = { lowest: 60, highest: 80, unit: "f", group: "tops" };
    const once = closetSearch(raw);
    expect(once).toStrictEqual({ group: "tops", from: 15.6, to: 26.7 });
    expect(closetSearch({ ...raw, ...once })).toStrictEqual(once);
    expect(
      closetSearch({ ...raw, ...closetSearch({ ...raw, ...once }) }),
    ).toStrictEqual(once);
  });

  it("reads an unknown unit as Celsius rather than guessing", () => {
    expect(closetSearch({ lowest: 34, unit: "k" })).toStrictEqual({
      from: 34,
    });
  });

  it("drops an empty field the form sent, falling back to nothing", () => {
    expect(closetSearch({ lowest: "", highest: "", unit: "f" })).toStrictEqual(
      {},
    );
  });

  it("drops an end that is not a number, and a span that runs backwards", () => {
    expect(closetSearch({ from: "", to: "" })).toStrictEqual({});
    expect(closetSearch({ from: Infinity, to: NaN })).toStrictEqual({});
    expect(closetSearch({ from: 20, to: 5 })).toStrictEqual({});
    expect(closetSearch({ from: 5, to: 5 })).toStrictEqual({ from: 5, to: 5 });
    expect(closetSearch({ from: "x", to: 5 })).toStrictEqual({ to: 5 });
  });

  it("never carries a deleted garment's name, which only history state may", () => {
    expect(
      closetSearch({ retired: true, deleted: "Pegasus 40" }),
    ).toStrictEqual({ retired: true });
    expect(closetSearch({ deleted: "Pegasus 40" })).toStrictEqual({});
  });
});
