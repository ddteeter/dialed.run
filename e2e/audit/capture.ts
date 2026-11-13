/**
 * The audit specs' moves (design 205): open a screen, or press something on
 * it, wait for it to settle, and assert it. The assertion is what makes the
 * a11y fixture check the page, and the check is what takes the shot, so a
 * move that asserts nothing is never shot.
 *
 * A move that cannot be made is recorded on the test as an `audit`
 * annotation and the spec goes on: a capture is a survey, and one missing
 * button must not cost the rest of the run.
 */
import type { Locator, Page } from "@playwright/test";

import { expect, test } from "../support/a11y";
import { withForcedKey } from "./shot-plan";

/**
Records a move that could not be made, in the report.
*/
export function note(description: string): void {
  test.info().annotations.push({ type: "audit", description });
}

/**
 * Waits for a step that may time out or lose its page: a page that never
 * hydrates or never goes quiet is still shot as it is.
 */
async function bestEffort(step: Promise<unknown>): Promise<void> {
  try {
    await step;
  } catch {
    // Shot as it stands.
  }
}

/**
 * Waits for hydration and the network, then scrolls the page through with
 * every image eager, so lazy images are in before the shot.
 */
export async function settle(page: Page): Promise<void> {
  await bestEffort(
    page
      .locator('html[data-hydrated="true"]')
      .waitFor({ state: "attached", timeout: 15_000 }),
  );
  await bestEffort(page.waitForLoadState("networkidle", { timeout: 8000 }));
  await bestEffort(
    page.evaluate(async () => {
      const images = [...globalThis.document.querySelectorAll("img")];
      for (const image of images) image.loading = "eager";
      const height = globalThis.document.documentElement.scrollHeight;
      for (let y = 0; y < height; y += 600) {
        globalThis.scrollTo(0, y);
        await new Promise((resolve) => {
          globalThis.setTimeout(resolve, 40);
        });
      }
      globalThis.scrollTo(0, 0);
      await Promise.all(
        images
          .filter((image) => !image.complete)
          .map(
            (image) =>
              new Promise((resolve) => {
                image.addEventListener("load", resolve);
                image.addEventListener("error", resolve);
                globalThis.setTimeout(resolve, 4000);
              }),
          ),
      );
    }),
  );
}

/**
 * Opens a screen and asserts it. The shot hook keys a state by route,
 * query keys and structure, so a second value of the same filter passes a
 * `tag` to give it a query key of its own.
 */
export async function see(
  page: Page,
  url: string,
  tag?: string,
): Promise<void> {
  const joiner = url.includes("?") ? "&" : "?";
  await page.goto(tag === undefined ? url : `${url}${joiner}${tag}=1`);
  await settle(page);
  await expect(page.locator("body")).toBeVisible();
}

/**
Presses the first match, then looks; a note if it can't.
*/
export async function press(
  page: Page,
  target: Locator,
  what: string,
): Promise<void> {
  try {
    await target.first().click({ timeout: 4000 });
    await settle(page);
    await expect(page.locator("body")).toBeVisible();
  } catch {
    note(`could not press ${what} at ${page.url()}`);
  }
}

/**
Types into the first search box and submits, then looks.
*/
export async function search(page: Page, text: string): Promise<void> {
  try {
    const box = page
      .getByRole("searchbox")
      .or(page.getByRole("textbox"))
      .first();
    await box.fill(text, { timeout: 4000 });
    await box.press("Enter");
    await settle(page);
    await expect(page.locator("main").first()).toBeVisible();
  } catch {
    note(`no search box at ${page.url()}`);
  }
}

/**
 * Shoots whatever is on screen now as a state of its own. A typed value, a
 * ticked radio or a receipt can leave the route, query keys and structure
 * as they were, so this swaps in a `z-` query key of its own first.
 */
export async function shoot(page: Page, what: string): Promise<void> {
  await settle(page);
  const href = withForcedKey(page.url(), what);
  await bestEffort(
    page.evaluate((next) => {
      globalThis.history.replaceState(globalThis.history.state, "", next);
    }, href),
  );
  await expect(page.locator("body")).toBeVisible();
}

/**
A step that may not be reachable: a note, and the spec carries on.
*/
export async function attempt(
  what: string,
  step: () => Promise<void>,
): Promise<void> {
  try {
    await step();
  } catch (error) {
    note(`missed ${what}: ${String(error).split("\n", 1).join("")}`);
  }
}
