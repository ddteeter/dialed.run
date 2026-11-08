/**
 * Covers: a deploy's production smoke test (design 186, #504), run by the
 * deploy job against the version it uploaded, before that version takes
 * any traffic. `playwright.smoke.config.ts` adds the version override to
 * every request.
 *
 * **Read-only, always.** This runs in production as the seeded smoke
 * account, and D-108's published anonymous totals count private runs, so
 * it never logs a run, saves a kit, adds a garment or changes a setting.
 * Logging in, which writes a session row, is the only write.
 */
import { expect, test, type Page } from "@playwright/test";

import { smokeTarget } from "./target";

const target = smokeTarget(process.env);

/**
The garment the checklist has the owner add to the smoke account.
*/
const SMOKE_GARMENT = "Smoke test shirt";

async function hydrated(page: Page): Promise<void> {
  await page
    .locator('html[data-hydrated="true"]')
    .waitFor({ state: "attached" });
}

test("the override reaches the uploaded version, and it is healthy", async ({
  request,
}) => {
  const response = await request.get("/api/health");
  const body: unknown = await response.json();

  // First, because an override Cloudflare does not apply falls back to
  // the old version without a word, and every check below would pass on
  // the old code.
  expect(body).toMatchObject({ version: target.versionId });
  expect(response.status()).toBe(200);
  expect(body).toMatchObject({ ok: true, missing: [], staleCrons: [] });
});

test("the signed-out landing renders and hydrates", async ({ page }) => {
  await page.goto("/");
  await hydrated(page);

  await expect(
    page.locator("[data-slot='landing-bar']").getByRole("link", {
      name: "Log in",
    }),
  ).toBeVisible();
});

test("the smoke account logs in and sees its closet", async ({ page }) => {
  const { account } = target;

  await page.goto("/auth/login");
  await hydrated(page);
  await page.getByLabel("Email").fill(account.email);
  await page.getByLabel("Password").fill(account.password);
  await page.getByRole("button", { name: "Log in" }).click();
  await expect(page).not.toHaveURL(/\/auth\//u, { timeout: 15_000 });

  await page.goto("/closet");
  await hydrated(page);
  await expect(page.getByText(SMOKE_GARMENT)).toBeVisible();
});
