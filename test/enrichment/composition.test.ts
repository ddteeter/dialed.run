import { describe, expect, it } from "vitest";

import { parseComposition } from "../../src/modules/enrichment/composition";

/**
 * Composition is the field the lane exists for, and it never arrives tidy —
 * it is prose written by whoever built the shop. These are the shapes seen
 * on real running-kit pages.
 */
describe("parseComposition", () => {
  it("reads the ordinary two-fibre case, whole", () => {
    expect(parseComposition("88% polyester, 12% elastane")).toStrictEqual({
      verbatim: "88% polyester, 12% elastane",
      parts: [
        {
          materials: [
            { material: "polyester", pct: 88 },
            { material: "elastane", pct: 12 },
          ],
        },
      ],
    });
  });

  it.each([
    // Percentage after the fibre rather than before it.
    ["Polyester 88% / Elastane 12%", 88, "polyester", 12, "elastane"],
    // A space before the sign, common on European shops.
    ["88 % polyester, 12 % elastane", 88, "polyester", 12, "elastane"],
    // Two decimals, not one: a single-digit parse reads 99.55 as 99.5.
    ["99.55% cotton, 0.45% elastane", 99.55, "cotton", 0.45, "elastane"],
    // "and" as the separator, not a comma.
    ["70% merino and 30% nylon", 70, "merino", 30, "nylon"],
  ])("reads the percentages in %s", (raw, aPct, aName, bPct, bName) => {
    expect(parseComposition(raw)?.parts?.[0]?.materials).toStrictEqual([
      { material: aName, pct: aPct },
      { material: bName, pct: bPct },
    ]);
  });

  it("keeps a multi-word fibre whole", () => {
    // "recycled polyester" is the fibre. Splitting on the space would leave
    // "recycled" and "polyester" as two separate materials.
    expect(
      parseComposition("100% Recycled Polyester")?.parts?.[0]?.materials,
    ).toStrictEqual([{ material: "recycled polyester", pct: 100 }]);
  });

  it("labels the parts of a multi-part garment", () => {
    // The case design called out (D-34): a lined short is two fabrics doing
    // two jobs, and "88% polyester" without knowing it is the liner is a
    // fact about nothing.
    const raw =
      "Body: 100% recycled polyester; Liner: 88% polyester, 12% spandex";
    expect(parseComposition(raw)).toStrictEqual({
      verbatim: raw,
      parts: [
        {
          part: "Body",
          materials: [{ material: "recycled polyester", pct: 100 }],
        },
        {
          part: "Liner",
          materials: [
            { material: "polyester", pct: 88 },
            { material: "spandex", pct: 12 },
          ],
        },
      ],
    });
  });

  it("finds labels with no space after the separator", () => {
    // Scraped markup arrives compacted as often as not. The label rule
    // anchors to the separator itself, so ";Liner:" has to work — matching
    // from any character instead would read the label as "iner".
    const parsed = parseComposition("Body:100% nylon;Liner:88% polyester");
    expect(parsed?.parts?.map((part) => part.part)).toStrictEqual([
      "Body",
      "Liner",
    ]);
  });

  it("trims a label written with a space before its colon", () => {
    expect(parseComposition("Outer shell : 100% nylon")?.parts?.[0]?.part).toBe(
      "Outer shell",
    );
  });

  it("degrades an unlabeled multi-fibre string to one unlabeled part", () => {
    // Required by the packet: no labels means no invented ones.
    const parsed = parseComposition("60% nylon, 30% polyester, 10% elastane");
    expect(parsed?.parts).toHaveLength(1);
    expect(parsed?.parts?.[0]?.part).toBeUndefined();
    expect(parsed?.parts?.[0]?.materials).toHaveLength(3);
  });

  it("drops a labelled section that names no fibre at all", () => {
    // "Care: cold wash" is a label with no percentage behind it. It must not
    // become a part that claims a name and lists nothing.
    const parsed = parseComposition("Shell: 100% nylon; Care: cold wash");
    expect(parsed?.parts).toHaveLength(1);
    expect(parsed?.parts?.[0]?.part).toBe("Shell");
  });

  it("has no material to record when a percentage stands alone", () => {
    // "50% / 50%" names no fibres. The row keeps verbatim and claims no
    // parts, rather than recording two materials with empty names.
    const parsed = parseComposition("50% / 50%");
    expect(parsed?.verbatim).toBe("50% / 50%");
    expect(parsed?.parts).toBeUndefined();
  });

  it("drops prose that shares a sentence with a real composition", () => {
    // "imported" is not a fabric. A material with no percentage of its own
    // is dropped rather than guessed at — verbatim still has it.
    expect(
      parseComposition("88% polyester, 12% elastane, imported")?.parts?.[0]
        ?.materials,
    ).toStrictEqual([
      { material: "polyester", pct: 88 },
      { material: "elastane", pct: 12 },
    ]);
  });

  it("can be fooled, which is exactly why verbatim is the authority", () => {
    // "Made with 100% care in Portugal" is marketing, and a percentage next
    // to words is all this parser asks for — so it produces a fibre called
    // "made with care in portugal". That is the honest limit of a regex over
    // prose, and it is survivable only because the original is kept: a
    // better parser, or the LLM rung, re-runs over `verbatim` later (D-31).
    //
    // Asserted rather than hidden. A test that pretended this case comes out
    // clean would be describing a parser we do not have.
    const raw = "Made with 100% care in Portugal";
    const parsed = parseComposition(raw);
    expect(parsed?.verbatim).toBe(raw);
    expect(parsed?.parts?.[0]?.materials).toStrictEqual([
      { material: "made with care in portugal", pct: 100 },
    ]);
  });

  it("is not a composition without a number", () => {
    // A description is full of fibre words. Requiring a percentage is the
    // cheapest signal that someone was stating a fact rather than selling.
    expect(
      parseComposition("Soft merino feel, built for cold mornings"),
    ).toBeUndefined();
    expect(parseComposition("")).toBeUndefined();
    expect(parseComposition(" ".repeat(3))).toBeUndefined();
  });

  it("collapses whitespace into verbatim without losing the text", () => {
    expect(
      parseComposition("  88%   polyester,\n  12% elastane  ")?.verbatim,
    ).toBe("88% polyester, 12% elastane");
  });
});
