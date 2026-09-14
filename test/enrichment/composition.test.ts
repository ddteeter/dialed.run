import { describe, expect, it } from "vitest";

import {
  parseComposition,
  stopwords,
} from "../../src/modules/enrichment/composition";

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

  it("says nothing when a percentage names no fibre at all", () => {
    // "50% / 50%" names nothing. Storing a verbatim with no parts would put
    // that string in the column and, under fill-only-what-is-blank, stop a
    // later rung that had the real composition.
    expect(parseComposition("50% / 50%")).toBeUndefined();
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

  it.each([
    ["Made with 100% care in Portugal", "marketing that mentions a number"],
    ["20% off today! Save 15% with code RUN.", "a sale"],
    ["Rated 100% by 40 runners", "a review score"],
  ])("is not fooled by %s — %s", (raw) => {
    // This used to be a documented failure: a percentage beside words was
    // all the parser asked for, so it produced a fibre called "made with
    // care in portugal". Requiring a *known fibre* beside the number is what
    // retired it, and the discount cases are not hypothetical — the Janji
    // page carries six "% off" strings against three real ones.
    expect(parseComposition(raw)).toBeUndefined();
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

  it("ignores a fibre named with no percentage of its own", () => {
    // "88% polyester, elastane" states one proportion and mentions a second
    // fibre. Without the percentage guard the second becomes a material with
    // a NaN percentage — a number that survives into the column and makes
    // every later comparison against it false.
    const parsed = parseComposition("88% polyester, elastane");
    expect(parsed?.parts?.[0]?.materials).toStrictEqual([
      { material: "polyester", pct: 88 },
    ]);
  });
  it("puts a space where an entity was, not nothing", () => {
    // "merino&nbsp;wool" is two words. Deleting the entity instead of
    // replacing it yields "merinowool", which is not a fibre this knows —
    // so the composition disappears rather than arriving slightly wrong.
    expect(
      parseComposition("100% merino&nbsp;wool")?.parts?.[0]?.materials,
    ).toStrictEqual([{ material: "merino wool", pct: 100 }]);
  });

  it("drops a stray unit character sitting against the fibre", () => {
    // Spec sheets write the micron grade: "47% 17.5μ merino wool". The
    // digits go with the percentage and leave a lone "μ", which is a letter
    // and would otherwise become part of the fibre's name.
    expect(
      parseComposition("47% 17.5\u{3BC} merino wool")?.parts?.[0]?.materials,
    ).toStrictEqual([{ material: "merino wool", pct: 47 }]);
  });

  it("drops every stopword it lists, next to a fibre", () => {
    // Looped at run time rather than `it.each`, which is evaluated while the
    // file is being collected: a `stopwords()` that returned nothing would
    // break collection instead of failing an assertion, and a test that
    // never ran reads the same as one that passed.
    //
    // Driven off the list itself, so an entry added without a case is not an
    // entry nothing checks. Each is a word that can sit against a fibre in
    // prose and is never part of its name.
    expect(stopwords().length).toBeGreaterThan(3);
    for (const word of stopwords()) {
      expect(
        parseComposition(`100% ${word} wool`)?.parts?.[0]?.materials,
        word,
      ).toStrictEqual([{ material: "wool", pct: 100 }]);
    }
  });

  it("keeps the fibre and its qualifiers, not the sentence around them", () => {
    // Five words of prose in front of the fibre. The name is the fibre plus
    // at most two words, so the run-up is dropped — otherwise a meta
    // description becomes a material.
    expect(
      parseComposition("24% a lightweight woven fabric places merino wool")
        ?.parts?.[0]?.materials,
    ).toStrictEqual([{ material: "places merino wool", pct: 24 }]);
  });

  it("unwraps an ampersand nested as deep as it comes", () => {
    // JSON-escaped, then HTML-escaped twice. Stopping one unwrap short
    // leaves an entity the strip eats, taking the separator between two
    // fibres with it and merging them into one nonsense material.
    expect(
      parseComposition(
        String.raw`91% recycled polyester \u0026amp;amp; 9% spandex`,
      )?.parts?.[0]?.materials,
    ).toStrictEqual([
      { material: "recycled polyester", pct: 91 },
      { material: "spandex", pct: 9 },
    ]);
  });
});
