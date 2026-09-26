/**
 * Covers: the signed-out shell (round 21 item 23, round 22 Auth §2, X1) —
 * the landing bar at 720 and up, no bar below it, and no tab bar on any
 * signed-out page. One journey, one video.
 */
import { expect, scene, test } from "../support/demo";

async function hydrated(page: import("@playwright/test").Page): Promise<void> {
  await page
    .locator('html[data-hydrated="true"]')
    .waitFor({ state: "attached" });
}

test("the landing bar at width, nothing below it, and never a tab bar", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1040, height: 760 });
  await page.goto("/");
  await hydrated(page);

  await scene(page, "/ at 1040 · a wordmark and one action, Log in");
  const bar = page.locator("[data-slot='landing-bar']");
  await expect(bar).toBeVisible();
  await expect(bar.getByRole("link", { name: "Log in" })).toBeVisible();
  await expect(page.locator("[data-slot='top-bar']")).toHaveCount(0);
  await expect(page.locator("[data-slot='tab-bar']")).toHaveCount(0);

  await scene(page, "Auth takes the same bar, with no action");
  await bar.getByRole("link", { name: "Log in" }).click();
  await expect(page).toHaveURL(/\/auth\/login/u);
  await hydrated(page);
  await expect(bar).toBeVisible();
  await expect(bar.getByRole("link")).toHaveCount(1);
  await expect(page.getByRole("heading", { name: "Log in" })).toBeVisible();

  await scene(page, "Below 720 · no bar, the page's wordmark does it");
  await page.setViewportSize({ width: 390, height: 760 });
  await expect(bar).toBeHidden();
  await expect(
    page.locator("main [data-part='wordmark']"),
  ).toBeVisible();

  await scene(page, "A signed-out 404 · no bars, and the way out is Log in");
  await page.goto("/nowhere-at-all");
  await hydrated(page);
  await expect(page.getByRole("heading", { name: "Nothing here" })).toBeVisible();
  await expect(page.locator("[data-slot='tab-bar']")).toHaveCount(0);
  await expect(page.getByRole("link", { name: "Log in" })).toBeVisible();
});
