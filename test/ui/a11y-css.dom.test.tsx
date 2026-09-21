import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

/**
 * `src/ui/a11y.css` against the Accessibility Contract's rules 03 and 06.
 *
 * Read off disk and named `.dom.` for the reason `tokens.dom.test.tsx` and
 * `motion-css.dom.test.tsx` both give: Vite's CSS plugin claims a `.css`
 * file before `?raw` is honoured, so an inlined read returns the empty
 * string and every assertion below would pass against a file nobody read.
 * The workers pool has no real filesystem; this project runs in Node.
 *
 * These two rules are the whole app's, so nothing that renders can pin
 * them — happy-dom applies no stylesheet, and a component test can only
 * say which class an element carries. What a class *means* lives here.
 */
const read = (path: string): string =>
  readFileSync(new URL(path, import.meta.url), "utf8");

const css = read("../../src/ui/a11y.css");

/**
 * Rules only. Half this file is prose explaining why each value is the
 * contract's, and that prose quotes the very strings these assertions look
 * for — the `:focus` check below matched the sentence "`:focus-visible`
 * rather than `:focus`" before this existed, which is a test failing on
 * its own documentation.
 */
const rules = css.replaceAll(/\/\*[\s\S]*?\*\//gu, "");

/**
 * The body of a braced block starting at `open` (the index of its `{`).
 *
 * Same shape as `motion-css.dom.test.tsx`'s, and deliberately not imported
 * from it: that one counts `@utility` blocks in a file of nested media
 * queries, this one reads two selectors. Sharing a four-line brace matcher
 * would couple two files that ask different questions.
 */
function bodyAt(source: string, open: number): string {
  let depth = 0;
  for (let index = open; index < source.length; index += 1) {
    const char = source[index];
    if (char === "{") depth += 1;
    else if (char === "}") {
      depth -= 1;
      if (depth === 0) return source.slice(open + 1, index);
    }
  }
  return "";
}

function blockAfter(marker: string): string {
  const at = css.indexOf(marker);
  if (at === -1) return "";
  return bodyAt(css, css.indexOf("{", at));
}

describe("06 · focus is visible and square", () => {
  it("draws the contract's ring, to the pixel", () => {
    // "2px solid outline, offset 2px, in the text colour of the ground."
    // Each number is the contract's, so each is asserted rather than
    // described: a ring at 1px or with no offset is a different ring.
    const ring = blockAfter("[tabindex]:focus-visible");
    expect(ring).toContain("outline: 2px solid var(--ink)");
    expect(ring).toContain("outline-offset: 2px");
  });

  it("names the ground's text colour rather than a hex, so the ink block inverts with it", () => {
    // "ink on paper, paper on ink" is one declaration because `--ink` is
    // already defined as ground's opposite and `tokens.css`'s
    // `[data-ground="ink"]` already swaps it. A literal here would be
    // right on paper and invisible on the inverted header blocks — and
    // would need a second pass for task 111's dark column.
    expect(rules).not.toMatch(/#[\da-f]{3,8}/iu);
    expect(rules).toContain("var(--ink)");
  });

  it("reaches every element that can take focus, not just buttons", () => {
    // A list, because there is no selector for "focusable". Missing one
    // is silent: the element simply has no ring, which is exactly the
    // state this rule exists to end.
    for (const element of [
      "a",
      "button",
      "input",
      "select",
      "textarea",
      "summary",
      "[tabindex]",
    ]) {
      expect(rules).toContain(`${element}:focus-visible`);
    }
  });

  it("is :focus-visible, never :focus — a pointer press leaves no ring", () => {
    expect(rules).not.toMatch(/[^-]:focus\b(?!-visible)/u);
  });

  it("puts a field's ring on its box and takes it off the input, in one block", () => {
    // The two halves are the point. Five inputs used to carry
    // `outline-none`, which said "no ring" and nothing at all about where
    // the ring had gone — so removing the ancestor would have left five
    // controls with no focus indicator and nothing to notice it.
    const fieldBox = blockAfter("@utility field-box");
    expect(fieldBox).toContain("outline: 2px solid var(--ink)");
    expect(fieldBox).toContain("outline: none");
    expect(fieldBox).toMatch(/&:has\(:focus-visible\)/u);
    expect(fieldBox).toMatch(/& :focus-visible/u);
  });
});

describe("03 · 44px targets", () => {
  it("pads the target to 44 in both directions", () => {
    const target = blockAfter("@utility target");
    expect(target).toContain("min-height: 44px");
    expect(target).toContain("min-width: 44px");
  });

  it("pads rather than sizes, so a target already big enough does not move", () => {
    // "Pad the target, not the glyph." `height` would shrink a submit
    // button from 52px to 44; `min-height` leaves it alone. And nothing
    // here touches type: the glyph is the drawing's.
    const target = blockAfter("@utility target");
    expect(target).not.toMatch(/(?<!min-)(?:height|width):/u);
    expect(target).not.toMatch(/font-size|font:/u);
  });
});
