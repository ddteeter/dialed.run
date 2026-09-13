import { describe, expect, it } from "vitest";

import { isFibre, knownFibres } from "../../src/modules/enrichment/fibres";

describe("isFibre", () => {
  it.each([
    ["polyester", "the plain case"],
    ["recycled polyester", "with a qualifier in front"],
    ["merino wool", "two words, both fibres"],
    ["17.5μ merino wool", "with the micron grade a spec sheet adds"],
    ["Elastane", "capitalised"],
    ["100% cotton-rich", "hyphenated"],
  ])("recognises %s — %s", (material) => {
    expect(isFibre(material)).toBe(true);
  });

  it.each([
    ["off", "what a discount leaves behind"],
    ["save", "the other half of a sale"],
    ["made with care in portugal", "marketing prose"],
    ["", "nothing at all"],
    ["primeflex", "a proprietary fibre the list does not have"],
  ])("does not recognise %s — %s", (material) => {
    expect(isFibre(material)).toBe(false);
  });

  it("matches a word, not a substring", () => {
    // "wooly" and "cottoned" are not fibres, and a substring test would call
    // them one. Splitting on non-letters is what makes "merino wool" work
    // without making "woolen-feel lining" a composition.
    expect(isFibre("wooly")).toBe(false);
    expect(isFibre("cottoned")).toBe(false);
    expect(isFibre("polyesterish")).toBe(false);
  });

  it("exposes the vocabulary for the model rung's candidate check", () => {
    // The feedback loop reads this to tell a fibre it knows from one worth
    // recording as a candidate.
    expect(knownFibres()).toContain("merino");
    expect(knownFibres().length).toBeGreaterThan(20);
  });

  it("is a sorted list of lowercase single words", () => {
    // It is a data table a human edits by hand. Keeping it sorted and
    // lowercase is what makes an addition a one-line diff and stops the same
    // fibre being added twice in two cases.
    const fibres = knownFibres();
    // Checked pairwise rather than against a sorted copy: `sort` is banned
    // here and `toSorted` is not in this branch's TS lib — the ES2024 bump
    // is on lane 105 and unmerged. Comparing neighbours says the same thing
    // and names the offending pair when it fails.
    for (const [index, fibre] of fibres.entries()) {
      const next = fibres[index + 1];
      if (next === undefined) continue;
      expect(fibre.localeCompare(next), `${fibre} then ${next}`).toBeLessThan(
        0,
      );
    }
    for (const fibre of fibres) expect(fibre).toBe(fibre.toLowerCase());
  });
});
