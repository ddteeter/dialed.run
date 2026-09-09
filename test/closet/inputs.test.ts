import { describe, expect, it } from "vitest";

import { garmentCategories } from "../../src/lib/contracts";
import { newUlid } from "../../src/lib/ids";
import {
  closetFiltersInput,
  itemIdInput,
  newItemInput,
  requireFormData,
  updateItemInput,
} from "../../src/modules/closet/inputs";

/**
 * The closet server functions' input contracts.
 *
 * They lived in `functions.ts`, which cannot be imported by a test at all
 * (D-41) — so the filter set every closet read is parsed against, and the
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
    expect(
      closetFiltersInput.safeParse({ windResistant: false }).success,
    ).toBe(true);
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
