import { describe, expect, it } from "vitest";

import { findComposition } from "../../src/modules/enrichment/composition";

/**
 * The extractor against phrasing real shops actually use.
 *
 * Each fixture is one text node from a real product page, kept byte-for-byte
 * — entities, JSON escapes, micron grades and all — and nothing else from
 * the page. See `fixtures/MANIFEST.md` for provenance and why so little is
 * stored.
 *
 * These are the cases that changed the design. Hand-written fixtures said
 * composition lived in `body_html` behind a "Fabric:" cue; these said it is
 * in a metafield labelled "Specs", or a sentence in a meta description, or a
 * JSON attribute, and that a cue is the wrong thing to look for.
 */
/**
 * Inlined by Vite at build time, not read from disk: the workers pool
 * sandboxes the real filesystem, so `readFileSync` cannot reach these — the
 * same reason the architecture tests glob their sources.
 */
const FIXTURES: Record<string, string> = import.meta.glob(
  "./fixtures/*.fragment.html",
  { query: "?raw", import: "default", eager: true },
);

function fixture(name: string): string {
  return FIXTURES[`./fixtures/${name}.fragment.html`] ?? "";
}

describe("composition, on real pages", () => {
  it.each([
    ["ciele-ortshirt", [[100, "recycled cotton"]]],
    [
      "districtvision-cordura-socks",
      [
        [55, "cotton"],
        [43, "nylon"],
        [2, "polyurethane"],
      ],
    ],
    [
      "janji-merino-tee",
      [
        [47, "merino wool"],
        [38, "nylon"],
        [15, "nylon"],
      ],
    ],
    ["pathprojects-shell-jacket", [[100, "toray primeflex polyester"]]],
    [
      "rabbit-chaser-track-pant",
      [
        [91, "body recycled polyester"],
        [9, "spandex"],
      ],
    ],
    ["satisfy-mothtech-tee", [[100, "organic cotton"]]],
    ["soar-wooltech-half-tights", [[24, "merino wool"]]],
  ])("reads %s", (name, expected) => {
    const materials = findComposition(fixture(name))?.parts?.[0]?.materials;
    expect(materials).toStrictEqual(
      expected.map(([pct, material]) => ({ material, pct })),
    );
  });

  it("finds nothing on a page that states no composition", () => {
    // Not every product page has one, and inventing something for this one
    // would be worse than leaving the column null.
    expect(findComposition(fixture("soar-run-shorts"))).toBeUndefined();
  });
});
