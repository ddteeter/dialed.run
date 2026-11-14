/**
 * Covers: the one signed-out frame (Round 55 · 176) — its bar at every
 * width, Log in as text and Request access from 720, a page dropping its
 * own ask, the landing hero's ask below 720 (175), the five-link footer,
 * and the signed-out 404 in the frame (174). No tab bar on any signed-out
 * page. One journey, one video.
 */
import { expect, scene, test } from "../support/demo";

async function hydrated(page: import("@playwright/test").Page): Promise<void> {
  await page
    .locator('html[data-hydrated="true"]')
    .waitFor({ state: "attached" });
}

test("one signed-out frame: the bar at every width, the page's own ask, and never a tab bar", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1040, height: 760 });
  await page.goto("/");
  await hydrated(page);

  await scene(page, "/ at 1040 · the wordmark, Log in and Request access");
  const bar = page.locator("[data-slot='landing-bar']");
  await expect(bar).toBeVisible();
  await expect(bar.getByRole("link", { name: "Log in" })).toBeVisible();
  await expect(bar.getByRole("link", { name: "Request access" })).toBeVisible();
  await expect(page.locator("[data-slot='top-bar']")).toHaveCount(0);
  await expect(page.locator("[data-slot='tab-bar']")).toHaveCount(0);

  // The bar holds Request access from 720, so the hero ends on the
  // cross-link.
  await scene(page, "The hero: Have a code? Create an account");
  const hero = page.getByRole("main");
  await expect(hero.getByRole("link", { name: "Request access" })).toBeHidden();
  await expect(
    hero.getByRole("link", { name: "Create an account" }),
  ).toHaveAttribute("href", "/join");
  const footer = page.locator("[data-part='legal-footer']");
  await expect(footer.getByRole("link")).toHaveCount(5);

  // Below 720 the bar keeps the wordmark and Log in; the pill moves into
  // the hero.
  await scene(page, "Below 720 · the bar stays, the pill moves to the hero");
  await page.setViewportSize({ width: 390, height: 760 });
  await expect(bar).toBeVisible();
  await expect(bar.getByRole("link", { name: "Request access" })).toBeHidden();
  await expect(
    hero.getByRole("link", { name: "Request access" }),
  ).toBeVisible();
  await page.setViewportSize({ width: 1040, height: 760 });

  await scene(page, "Log in drops its own Log in");
  await bar.getByRole("link", { name: "Log in" }).click();
  await expect(page).toHaveURL(/\/auth\/login/u);
  await hydrated(page);
  await expect(page.getByRole("heading", { name: "Log in" })).toBeVisible();
  await expect(bar.getByRole("link", { name: "Log in" })).toHaveCount(0);
  await expect(bar.getByRole("link", { name: "Request access" })).toBeVisible();

  await scene(page, "A signed-out 404 · in the frame, the way out is Log in");
  await page.goto("/nowhere-at-all");
  await hydrated(page);
  await expect(
    page.getByRole("heading", { name: "Nothing here" }),
  ).toBeVisible();
  await expect(bar).toBeVisible();
  await expect(page.locator("[data-slot='tab-bar']")).toHaveCount(0);
  await expect(
    page.getByRole("main").getByRole("link", { name: "Log in" }),
  ).toBeVisible();
  await expect(footer.getByRole("link")).toHaveCount(5);
});
