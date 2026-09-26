import { expect, test } from "@playwright/test";
import type { Page } from "@playwright/test";

import { storageStateFor } from "../support/accounts";
import { openBoard, screen } from "../support/conformance";
import { borderOf, fillOf, hydrated, partsIn, wordsOf } from "./auth-parts";

/**
 * `/`'s landing bar at 720 and 1040, signed out and signed in, built
 * against round 21's frames (`design/Round 21 Rulings.dc.html`).
 *
 * The regions (wordmark, one action), their words, and the action's
 * treatment — hairline when signed out, ink when signed in — read as T1
 * roles from the board and compared, never typed here.
 */
const BOARD = "Round 21 Rulings.dc.html";
const BAR = "[data-slot='landing-bar']";

async function compare(
  page: Page,
  baseURL: string,
  width: 720 | 1040,
  state: "logged out" | "signed in",
): Promise<void> {
  const label = `Landing bar ${String(width)} ${state}`;
  await openBoard(page, BOARD, baseURL);
  const order = await partsIn(page, screen(label));
  const words = await wordsOf(page, screen(label));
  const action = `${screen(label)} [data-part='bar-actions']`;
  const fill = await fillOf(page, action);
  const border = await borderOf(page, action);
  const barFill = await fillOf(page, screen(label));
  expect(order, `the board has no ${label} frame`).not.toHaveLength(0);

  await page.setViewportSize({ width, height: 800 });
  await page.goto("/");
  await hydrated(page);

  expect(await partsIn(page, BAR)).toEqual(order);
  expect(await wordsOf(page, BAR)).toEqual(words);
  expect(await fillOf(page, BAR)).toBe(barFill);
  expect(await fillOf(page, `${BAR} [data-part='bar-actions']`)).toBe(fill);
  expect(await borderOf(page, `${BAR} [data-part='bar-actions']`)).toBe(border);
  // "No nav, search, bell or 'Log a run'", and never the tab bar.
  await expect(page.locator("[data-slot='top-bar']")).toHaveCount(0);
  await expect(page.locator("[data-slot='tab-bar']")).toHaveCount(0);
}

test.describe("logged out", () => {
  for (const width of [720, 1040] as const) {
    test(`at ${String(width)}: the wordmark and a hairline Log in`, async ({
      page,
      baseURL,
    }) => {
      if (baseURL === undefined) throw new Error("no baseURL");
      await compare(page, baseURL, width, "logged out");
    });
  }

  test("below 720: no bar at all", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 800 });
    await page.goto("/");
    await hydrated(page);
    await expect(page.locator(BAR)).toBeHidden();
    await expect(page.locator("[data-slot='tab-bar']")).toHaveCount(0);
  });
});

test.describe("signed in", () => {
  test.use({ storageState: storageStateFor("closet") });

  for (const width of [720, 1040] as const) {
    test(`at ${String(width)}: the wordmark and an ink Your closet`, async ({
      page,
      baseURL,
    }) => {
      if (baseURL === undefined) throw new Error("no baseURL");
      await compare(page, baseURL, width, "signed in");
    });
  }
});
