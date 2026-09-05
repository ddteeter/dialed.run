import { expect, test } from "@playwright/test";

/** Layout stamps html[data-hydrated] once React attaches; driving
 *  controlled inputs before that races hydration's state reset. */
async function hydrated(page: import("@playwright/test").Page): Promise<void> {
  await page.locator('html[data-hydrated="true"]').waitFor({ state: "attached" });
}

test("home renders the brand hero", async ({ page }) => {
  await page.goto("/");
  await expect(
    page.getByRole("heading", { name: /every run has an outfit/i }),
  ).toBeVisible();
});

test("signup -> authenticated home -> sign out", async ({ page }) => {
  const email = `smoke-${String(Date.now())}@example.com`;
  await page.goto("/auth/signup");
  await hydrated(page);

  await page.getByLabel("Name").fill("Smoke Test");
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill("a-long-enough-password");
  await page.getByRole("button", { name: "Sign up" }).click();

  await expect(page.getByText(email)).toBeVisible({ timeout: 15_000 });
  await page.getByRole("button", { name: "Sign out" }).click();
  await expect(page.getByRole("link", { name: "Log in" })).toBeVisible();
});
