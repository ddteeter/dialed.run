import { describe, expect, it } from "vitest";

import { normalizeIdentity } from "../../src/lib/normalize";

describe("normalizeIdentity", () => {
  it("casefolds and strips punctuation/whitespace runs", () => {
    expect(normalizeIdentity("Ciele Athletics™")).toBe("ciele athletics");
    expect(normalizeIdentity("ciele  athletics")).toBe("ciele athletics");
  });

  it("replaces a symbol with a space, not nothing", () => {
    // The distinction only shows when the symbol sits *between* words —
    // every other test puts it at the end, where trimming hides the
    // difference. Two brands whose names differ only by a separator must
    // not collapse onto one canonical row.
    //
    // Found by mutation testing: `.replaceAll(/\p{Symbol}/gu, " ")` -> `""`
    // survived the whole suite.
    expect(normalizeIdentity("Nike®Air")).toBe("nike air");
    expect(normalizeIdentity("Nike Air")).toBe("nike air");
    expect(normalizeIdentity("NikeAir")).toBe("nikeair");
  });

  it("strips diacritics", () => {
    expect(normalizeIdentity("Björn Borg")).toBe("bjorn borg");
  });

  it("collapses mixed punctuation to single spaces and trims", () => {
    expect(normalizeIdentity("  On-Running!!  ")).toBe("on running");
  });

  it("dedup collisions land on the same normalized key", () => {
    const variants = ["Janji", " janji ", "JANJI", "Janji™"];
    const normalized = new Set(variants.map((value) => normalizeIdentity(value)));
    expect(normalized.size).toBe(1);
  });

  it("returns empty string for input with no letters or digits", () => {
    expect(normalizeIdentity("!!!")).toBe("");
  });
});
