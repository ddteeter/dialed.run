/**
 * Covers: account creation and sign-out — one journey, one video.
 *
 * Exactly one test() per demo spec. A second test here would record a
 * second video beside the one the reviewer is meant to watch; standalone
 * assertions belong in a sibling *.spec.ts (see home.spec.ts).
 *
 * No docs/product.md screen ID — auth is not in the screen inventory. When a
 * demo covers inventoried screens, list the IDs here instead; those IDs, not
 * this directory's name, are what other lanes grep to find the demo that
 * already owns a screen.
 */
import { expect, test } from "../support/demo";

/** Layout stamps html[data-hydrated] once React attaches; driving
 *  controlled inputs before that races hydration's state reset. */
async function hydrated(page: import("@playwright/test").Page): Promise<void> {
  await page
    .locator('html[data-hydrated="true"]')
    .waitFor({ state: "attached" });
}

test("signup -> authenticated home -> sign out", async ({ page }) => {
  const email = `smoke-${String(Date.now())}@example.com`;
  await page.goto("/auth/signup");
  await hydrated(page);

  await page.getByLabel("Name").fill("Smoke Test");
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill("a-long-enough-password");
  await page.getByRole("button", { name: "Sign up" }).click();

  // A new account lands in onboarding now, not on `/` (D-52) — and the
  // sign-out control lives on `/`. So the journey goes through the close
  // screen and out of its own "Done for now" link, which is the route a
  // real runner takes to reach the home page for the first time.
  await expect(page).toHaveURL(/\/onboarding\/calibrate/, { timeout: 15_000 });
  await page.goto("/onboarding/done");
  await page.getByRole("link", { name: "Done for now" }).click();

  await expect(page.getByText(email)).toBeVisible({ timeout: 15_000 });
  await page.getByRole("button", { name: "Sign out" }).click();
  await expect(page.getByRole("link", { name: "Log in" })).toBeVisible();
});
