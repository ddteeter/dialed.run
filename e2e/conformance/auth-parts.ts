import type { Page } from "@playwright/test";

import { colorRole, signatureOf } from "../support/conformance";

/**
 * Region-level comparison for the round-22 frames (Auth, the landing bar,
 * the system states), on top of `support/conformance.ts`.
 *
 * Those boards mark a screen's regions with `data-part` and the build
 * carries the same names, so the questions are: **which regions, in which
 * order**, and **what each one says**. Both read the same way on either
 * side, so a failure prints two lists and the entry that differs.
 */

/**
 * The `data-part` names under `root`, in document order, skipping design's
 * annotations, the phone's status bar (a drawing of the device, not the
 * app), and anything not laid out — a region hidden at this width is not
 * part of the composition at this width.
 *
 * Runs in the browser, so it closes over nothing.
 */
export async function partsIn(
  page: Page,
  root: string,
): Promise<readonly string[]> {
  return page.$$eval(`${root} [data-part]`, (elements) =>
    elements
      .filter((element) => {
        if (element.closest("[data-annotation]") !== null) return false;
        if ((element as HTMLElement).dataset.part === "status-bar") return false;
        return element.getClientRects().length > 0;
      })
      .map((element) => (element as HTMLElement).dataset.part ?? ""),
  );
}

/**
 * `partsIn`, without the parts named — the board's regions the build
 * deliberately does not mark, each with its reason at the call site.
 */
export async function partsExcept(
  page: Page,
  root: string,
  excluded: readonly string[],
): Promise<string[]> {
  const parts = await partsIn(page, root);
  return parts.filter((part) => !excluded.includes(part));
}

/**
 * A region's text as one flat list of runs — `signatureOf`'s rows joined,
 * so a region that folds differently at the two widths still compares.
 */
export async function wordsOf(
  page: Page,
  selector: string,
): Promise<readonly string[]> {
  const rows = await signatureOf(page, selector);
  return rows.flat();
}

/**
The T1 role a region's fill resolves to.
*/
export async function fillOf(page: Page, selector: string): Promise<string> {
  const computed = await page.$eval(
    selector,
    (element) => getComputedStyle(element).backgroundColor,
  );
  return colorRole(computed);
}

/**
The T1 role a region's top border resolves to.
*/
export async function borderOf(page: Page, selector: string): Promise<string> {
  const computed = await page.$eval(
    selector,
    (element) => getComputedStyle(element).borderTopColor,
  );
  return colorRole(computed);
}

/**
 * Waits for React to attach. Every spec here drives controlled inputs,
 * and a fill that lands before hydration is silently reset.
 */
export async function hydrated(page: Page): Promise<void> {
  await page
    .locator('html[data-hydrated="true"]')
    .waitFor({ state: "attached" });
}
