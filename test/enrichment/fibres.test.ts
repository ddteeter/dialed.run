import { describe, expect, it } from "vitest";

import { knownFibres } from "../../src/modules/enrichment/fibres";

/**
 * **What is left of the vocabulary after the gate came off** (owner,
 * 2026-09-14). `isFibre` used to decide whether a percentage beside some
 * words was a composition; it is gone, and with it the tests that pinned
 * what it accepted and refused.
 *
 * The list now goes into the model's prompt as a hint — "a material is a
 * fibre, such as …" — so what matters about it is that it stays readable
 * and editable by a person, and that it is really reaching the prompt. The
 * second of those is asserted in `model/chat-completions.test.ts`, where the
 * request is.
 */

describe("knownFibres", () => {
  it("carries the fibres a running-kit page actually names", () => {
    const fibres = knownFibres();
    for (const fibre of ["merino", "polyester", "nylon", "elastane"]) {
      expect(fibres, fibre).toContain(fibre);
    }
    expect(fibres.length).toBeGreaterThan(20);
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

  it("is one word per entry, because the prompt reads it as a list", () => {
    // A multi-word entry would render as "such as: …, merino wool, …" and
    // read as one example rather than two, which is the sort of thing that
    // quietly makes a prompt worse.
    for (const fibre of knownFibres()) {
      expect(fibre, fibre).not.toContain(" ");
    }
  });
});
