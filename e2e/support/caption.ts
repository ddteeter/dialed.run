/**
 * The pure half of `scene()` — how long a caption holds, and the CSS that
 * paints it.
 *
 * Split out of `demo.ts` so it can be tested. That file is Playwright-only:
 * most of what is left in it runs *inside the browser*, injected through
 * `page.addInitScript`, so vitest cannot execute a line of it and every
 * mutant there comes back alive. Keeping these two here would have meant
 * exempting them along with it — and they are not incidental, they carry
 * the rule the narration rests on.
 *
 * Same move the architecture already makes for routes: the untestable file
 * keeps the wiring, and the decisions move next door where a test reaches
 * them.
 */

/**
 * How long a caption holds, from how long it takes to read.
 *
 * ~230 words/minute is unhurried; the floor keeps a three-word caption on
 * screen long enough to register and the ceiling stops a long one stalling
 * the recording. These are the only pacing numbers left that a human tunes.
 */
const SCENE_MIN_MS = 1400;
const SCENE_PER_WORD_MS = 260;
const SCENE_MAX_MS = 4200;

export function holdFor(text: string): number {
  const words = text.trim().split(/\s+/u).length;
  return Math.min(
    Math.max(SCENE_MIN_MS, words * SCENE_PER_WORD_MS),
    SCENE_MAX_MS,
  );
}

/**
 * The whole caption, as one CSS rule.
 *
 * Mono, uppercase and pinned to the top edge: it has to read as
 * instrumentation laid over the app, never as product chrome a reviewer
 * might take for a real surface. Same pink as the synthetic cursor, which
 * is the other thing in this file that is not the product.
 *
 * **Top, because the bottom is the tab bar.** `Layout` puts five tabs
 * there and the demos click them, so a caption pinned to the bottom hid
 * the navigation a viewer is watching the cursor use — visible in a
 * recorded frame, not in any assertion. The top edge carries only the
 * notification bell, which no demo drives.
 *
 * Exported so `scene.spec.ts` can pin the property everything above rests
 * on — that the text is painted without entering the document.
 */
export function captionRule(text: string): string {
  // JSON.stringify is the escaping: a CSS string literal and a JS one agree
  // on quotes and backslashes, which is all a caption can contain.
  return `html::after {
    content: ${JSON.stringify(text)};
    position: fixed; inset: 0 0 auto 0; z-index: 2147483646;
    pointer-events: none;
    background: rgba(12,12,12,0.92); color: #f5f5f0;
    font: 500 13px/1.4 "IBM Plex Mono", ui-monospace, monospace;
    letter-spacing: 0.09em; text-transform: uppercase;
    padding: 14px 20px; border-bottom: 2px solid rgba(255,45,135,0.9);
  }`;
}
