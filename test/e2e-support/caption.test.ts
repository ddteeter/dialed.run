import { describe, expect, it } from "vitest";

import { captionRule, holdFor } from "../../e2e/support/caption";

/**
 * The pure half of the demo narration (D-58). `demo.ts` next to it is
 * Playwright-only — most of what is left there runs inside the browser via
 * `addInitScript` — so these two moved out to where a test can reach them
 * rather than being exempted along with it.
 */
describe("holdFor", () => {
  it("gives a longer caption longer, because reading it takes longer", () => {
    // Both sides have to clear the floor, or this compares 1400 with 1400
    // and passes whatever the rate is — which is what the first version of
    // this test did. Six words is the first length above it.
    expect(holdFor("one two three four five six seven eight")).toBeGreaterThan(
      holdFor("one two three four five six"),
    );
  });

  it("holds a short caption on screen long enough to register", () => {
    // Three words at 260ms would be 780ms — gone before it is read. The
    // floor is what stops a terse caption flashing past.
    expect(holdFor("O3 nothing ticked")).toBe(1400);
    expect(holdFor("O1")).toBe(1400);
  });

  it("stops a long caption stalling the recording", () => {
    const runOn = "word ".repeat(60);
    expect(holdFor(runOn)).toBe(4200);
  });

  it("counts words, not whitespace", () => {
    // The specs write captions by hand, so a double space or a stray
    // newline is a matter of time. Counting those as words, or failing to
    // trim the ends, would pad the hold with time nobody is reading for.
    //
    // **Six words, because fewer would clamp.** Comparing two captions
    // that both hit the 1400ms floor passes whatever the splitting does —
    // which is exactly how the first version of this test let a `.trim()`
    // and both regex mutants survive.
    const messy = "  one   two\nthree    four five  six  ";
    expect(holdFor(messy)).toBe(holdFor("one two three four five six"));
    expect(holdFor(messy)).toBe(6 * 260);
  });
});

describe("captionRule", () => {
  it("paints the text through content, so it never enters the document", () => {
    // The property scene.spec.ts proves end to end: a caption is drawn by
    // `html::after`, so no locator can match it and a narrated assertion
    // cannot be satisfied by its own narration.
    expect(captionRule("Closet: 6 pieces")).toContain("html::after");
    expect(captionRule("Closet: 6 pieces")).toContain(
      'content: "Closet: 6 pieces"',
    );
  });

  it("escapes a quote rather than ending the CSS string on it", () => {
    // An unescaped `"` would close the value and make the whole rule
    // invalid — the caption would silently not appear, which on a
    // recording looks like the helper simply not running.
    expect(captionRule('the 7" shorts')).toContain(
      String.raw`content: "the 7\" shorts"`,
    );
  });

  it("pins the caption to the top, because the tab bar owns the bottom", () => {
    // Layout's five tabs sit at the bottom and the demos click them; a
    // caption there hid the navigation a viewer watches the cursor use.
    expect(captionRule("x")).toContain("inset: 0 0 auto 0");
  });
});
