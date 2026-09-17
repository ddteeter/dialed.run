/**
 * The one property `scene()` rests on: a caption is painted without
 * entering the document.
 *
 * A demo caption says what the assertion beside it is about to prove, so
 * the two often share words — "Closet: 6 pieces" is both the narration and
 * the thing being checked. If the caption were a real element, every such
 * assertion would pass on the narration alone and prove nothing, and
 * nothing about the suite would look wrong. That failure is silent and
 * total, which is why it gets a test of its own rather than a comment.
 *
 * Not a demo spec: it asserts a mechanism, records no video, and belongs to
 * the `e2e` project that CI runs on every push.
 */
import { expect, test } from "@playwright/test";

import { captionRule } from "./caption";

const CAPTION = "Closet: 6 pieces";

test("a caption's text cannot satisfy a locator", async ({ page }) => {
  // The control, and it is the half that makes the rest mean anything: the
  // same words in a real element are found at once, so the misses below are
  // the pseudo-element being invisible rather than a query that never
  // matches. `setContent` builds it from Node — `page.evaluate` cannot be
  // used in this repo (unicorn/isolated-functions).
  await page.setContent(`<main><h1>${CAPTION}</h1></main>`);
  await expect(page.getByText(CAPTION)).toHaveCount(1);

  await page.setContent("<main><h1>Something else entirely</h1></main>");
  await page.addStyleTag({ content: captionRule(CAPTION) });

  // Painted — verified by eye against a recorded frame — and reachable by
  // nothing: not by text, not by the uppercase the CSS actually renders,
  // and not by the text engine's own selector.
  await expect(page.getByText(CAPTION)).toHaveCount(0);
  await expect(page.getByText(CAPTION.toUpperCase())).toHaveCount(0);
  await expect(page.locator("text=" + CAPTION)).toHaveCount(0);
});
