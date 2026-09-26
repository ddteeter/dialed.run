import { expect, test } from "@playwright/test";
import type { Page } from "@playwright/test";

import { storageStateFor } from "../support/accounts";
import { openBoard, screen } from "../support/conformance";
import { hydrated, partsExcept, partsIn, wordsOf } from "./auth-parts";

/**
 * Round 22's system states (`design/Round 22 Coverage.dc.html`, section
 * "New: System states"): X1 not found, X2 loader failed, X3 slow route,
 * signed in, at the phone width they are drawn at.
 *
 * **Known gap, asserted as one:** the board's `header` is the per-screen
 * ink header ("[dialed.run]", "← Closet") that no screen in the build has
 * yet — the phone's header row is the bell's seat. It is left out of the
 * order comparison and nothing else is.
 */
const BOARD = "Round 22 Coverage.dc.html";
const UNBUILT = new Set(["header"]);

test.use({ storageState: storageStateFor("closet") });

async function boardOrder(page: Page, label: string): Promise<string[]> {
  const order = await partsExcept(page, screen(label), [...UNBUILT]);
  expect(order, `the board has no ${label} frame`).not.toHaveLength(0);
  return order;
}

/**
The shell's parts on the built page, in the board's vocabulary.
*/
async function builtOrder(page: Page): Promise<string[]> {
  return [...(await partsIn(page, "body"))];
}

test("X1 not found, signed in: the shell stays, no tab lit", async ({
  page,
  baseURL,
}) => {
  if (baseURL === undefined) throw new Error("no baseURL");
  const label = "X Not found";
  await openBoard(page, BOARD, baseURL);
  const order = await boardOrder(page, label);
  const words = await wordsOf(
    page,
    `${screen(label)} [data-part='system-state']`,
  );

  await page.setViewportSize({ width: 390, height: 900 });
  await page.goto("/no-such-page");
  await hydrated(page);

  expect(await builtOrder(page)).toEqual(order);
  expect(await wordsOf(page, "[data-part='system-state']")).toEqual(words);
  await expect(page.locator("[data-slot='tab-indicator']")).toHaveCount(0);
});

test("X2 loader failed: the band, Didn't load, in the shell", async ({
  page,
  baseURL,
}) => {
  if (baseURL === undefined) throw new Error("no baseURL");
  const label = "X Loader failed";
  await openBoard(page, BOARD, baseURL);
  const order = await boardOrder(page, label);
  const band = await wordsOf(
    page,
    `${screen(label)} [data-part='failure-band']`,
  );

  await page.setViewportSize({ width: 390, height: 900 });
  await page.goto("/feed");
  await hydrated(page);
  // Every read from here fails, so the Closet tab's loader does.
  await page.route("**/_serverFn/**", (route) =>
    route.fulfill({ status: 500, body: "{}" }),
  );
  await page
    .locator("[data-slot='tab-bar']")
    .getByRole("link", { name: "Closet" })
    .click();
  await expect(page.locator("[data-part='system-state']")).toBeVisible({
    timeout: 15_000,
  });

  expect(await builtOrder(page)).toEqual(order);
  expect(await wordsOf(page, "[data-part='failure-band']")).toEqual(band);
});

test("X3 slow route: the old screen stays, the destination's label breathes", async ({
  page,
  baseURL,
}) => {
  if (baseURL === undefined) throw new Error("no baseURL");
  const label = "X Slow route";
  await openBoard(page, BOARD, baseURL);
  const tabs = await wordsOf(page, `${screen(label)} [data-part='tab-bar']`);

  await page.setViewportSize({ width: 390, height: 900 });
  await page.goto("/feed");
  await hydrated(page);
  const before = page.url();
  // Slow, not failing: every read waits two seconds, then goes through.
  await page.route("**/_serverFn/**", async (route) => {
    await new Promise((resolve) => {
      setTimeout(resolve, 2000);
    });
    await route.continue();
  });
  await page
    .locator("[data-slot='tab-bar']")
    .getByRole("link", { name: "Closet" })
    .click();

  const bar = page.locator("[data-part='tab-bar']");
  await expect(bar.locator(".breathe")).toHaveCount(2, { timeout: 1500 });
  expect(await wordsOf(page, "[data-part='tab-bar']")).toEqual(tabs);
  // No skeleton, no dimming: the feed is still what is on screen.
  expect(before).toContain("/feed");
  await expect(
    page.getByRole("status").filter({ hasText: "Loading Closet." }),
  ).toHaveCount(1);
});
