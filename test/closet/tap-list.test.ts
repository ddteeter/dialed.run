import { describe, expect, it } from "vitest";

import { garmentSchema } from "../../src/lib/contracts";
import {
  climateBands,
  tapListSelectionSchema,
  TAP_LISTS,
  type ClimateBand,
} from "../../src/modules/closet/tap-list";

/**
 * The curated tap lists, asserted as a table rather than transcribed.
 *
 * Sixty-seven mutants survived in `tap-list-data.ts` — every string and
 * every flag in it. The obvious answer, writing each row out again in a
 * test, is the wrong one: a hand-written second copy of a table is not a
 * check on the table, it is a rival copy of it, and CLAUDE.md's "derive,
 * don't mirror" is about exactly this. Nothing would make the two disagree
 * loudly.
 *
 * So these assert the *invariants* the table has to hold, and let
 * `garmentSchema` do the rest: an emptied category, layer, weight or name
 * stops parsing, and an emptied key breaks the band-prefix convention. One
 * assertion is about content, and it is a product rule rather than a
 * transcription: the cold list has to offer wind protection.
 */

function everyEntry(): { band: ClimateBand; key: string; garment: unknown }[] {
  return climateBands.flatMap((band) =>
    TAP_LISTS[band].map((entry) => ({
      band,
      key: entry.key,
      garment: entry.garment,
    })),
  );
}

describe("the tap-list table", () => {
  it("offers something in every band", () => {
    for (const band of climateBands) {
      expect(TAP_LISTS[band].length, band).toBeGreaterThan(0);
    }
  });

  it("holds only garments the contract accepts", () => {
    // Every wardrobe write goes through `garmentSchema` (CLAUDE.md), and a
    // tap-list save is a write. A row that cannot parse is a row that
    // throws on the one path onboarding depends on.
    for (const { band, key, garment } of everyEntry()) {
      const parsed = garmentSchema.safeParse(garment);
      expect(parsed.success, `${band}/${key}: ${parsed.error?.message ?? ""}`).toBe(
        true,
      );
    }
  });

  it("names every row, distinctly within its band", () => {
    // The name is what a runner taps. Two identical labels in one band is
    // a picker with two indistinguishable buttons.
    for (const band of climateBands) {
      const names = TAP_LISTS[band].map((entry) => entry.garment.name);
      for (const name of names) expect(name.length).toBeGreaterThan(0);
      expect(new Set(names).size, band).toBe(names.length);
    }
  });

  it("keys every row by its band, uniquely across the whole table", () => {
    // The key is what the client sends back, and `addFromTapList` looks it
    // up within a band — so a key that does not carry its band is a key
    // that can silently match the wrong list.
    const keys = everyEntry().map((entry) => entry.key);
    expect(new Set(keys).size).toBe(keys.length);
    for (const { band, key } of everyEntry()) {
      expect(key.startsWith(`${band}-`), key).toBe(true);
    }
  });

  it("gives no row a type", () => {
    // Type is a property of the *product*, written on match or by
    // enrichment; a tap-list save creates a generic garment with no
    // product. The row label is not a type — see the note in
    // tap-list-data.ts.
    for (const { key, garment } of everyEntry()) {
      expect(Object.hasOwn(garment as object, "type"), key).toBe(false);
    }
  });

  it("offers wind protection in the cold band", () => {
    // A product rule rather than a transcription: whatever the cold list
    // holds, a runner picking from it has to be able to get something that
    // blocks wind. Which row provides it is the table's business.
    const windproof = TAP_LISTS.cold.filter(
      (entry) =>
        "windResistant" in entry.garment && entry.garment.windResistant === true,
    );
    expect(windproof.length).toBeGreaterThan(0);
  });
});

describe("tapListSelectionSchema", () => {
  it("needs a band and at least one key", () => {
    expect(tapListSelectionSchema.safeParse({}).success).toBe(false);
    expect(
      tapListSelectionSchema.safeParse({ band: "cold", keys: [] }).success,
    ).toBe(false);
    expect(
      tapListSelectionSchema.safeParse({ band: "cold", keys: ["cold-tights"] })
        .success,
    ).toBe(true);
  });

  it("refuses a band that is not one", () => {
    expect(
      tapListSelectionSchema.safeParse({ band: "chilly", keys: ["x"] }).success,
    ).toBe(false);
  });

  it("caps the selection at more rows than any two bands hold", () => {
    // The bound stops a client posting thousands of keys; it is deliberately
    // above any real selection, so the assertion is that a plausible
    // maximum passes and one key past the cap does not.
    const cap = TAP_LISTS.cold.length + TAP_LISTS.mild.length;
    const keys = Array.from({ length: cap }, (_unused, index) =>
      String(index),
    );
    expect(
      tapListSelectionSchema.safeParse({ band: "cold", keys }).success,
    ).toBe(true);
    expect(
      tapListSelectionSchema.safeParse({ band: "cold", keys: [...keys, "one-more"] })
        .success,
    ).toBe(false);
  });
});
