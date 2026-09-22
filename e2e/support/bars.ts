import type { Locator, Page } from "@playwright/test";

/**
 * The bar that is actually on screen.
 *
 * Since task 115 the shell carries two — the phone's five-tab footer and
 * the Desktop Contract's top bar (DS1) — and **both are in the DOM at
 * every width**, because `data-ground="ink"` is an attribute and cannot be
 * applied per breakpoint. One is hidden by CSS. That is invisible to a
 * unit test and very visible to Playwright, where `getByRole("link", {
 * name: "Closet" })` suddenly resolves to two elements and strict mode
 * fails.
 *
 * So a spec that navigates asks for the visible one rather than for "the
 * Closet link", and the same line then works at 390 and at 1280 — which is
 * what lets one feature spec assert both widths instead of a parallel
 * desktop suite.
 */
export function bar(page: Page): Locator {
  return page.getByRole("navigation", { name: "Main" }).filter({ visible: true });
}

/**
 * The log-flow launcher, whichever seat it is in.
 *
 * It is not in the nav — it is a `<button aria-haspopup="dialog">` beside
 * it, because "a launcher cannot be where you are" (design round 12) — and
 * it says a different word at each width: `+ Add` in the phone bar's
 * glyph-sized seat, `Log a run` in the top bar, which has room for the
 * verb (round 15). Two elements, one hidden, so the name has to be a
 * pattern rather than a string.
 */
export function launcher(page: Page): Locator {
  return page
    .getByRole("button", { name: /^(Add|Log a run)$/ })
    .filter({ visible: true });
}

/**
 * Phone width, and the width the whole app was drawn at.
 *
 * 390 is `MEASURE.panel` and not a coincidence: every "centred at phone
 * width" surface on desktop is exactly this wide, so a spec that checks
 * the phone layout here is checking the same measure the panel uses.
 */
export const PHONE = { width: 390, height: 844 };

/**
 * Desk width — past `BREAKPOINT.desk` (1040), so the two-column screens
 * are in their two-column state. It is also the demo project's viewport,
 * which until this lane meant a phone-width app on a desktop canvas.
 */
export const DESK = { width: 1280, height: 720 };
