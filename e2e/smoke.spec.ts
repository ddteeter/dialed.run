import { expect, test } from "@playwright/test";

test("home renders the brand hero", async ({ page }) => {
  await page.goto("/");
  await expect(
    page.getByRole("heading", { name: /every run has an outfit/i }),
  ).toBeVisible();
});

test("signup -> authenticated home -> sign out", async ({ page }) => {
  const email = `smoke-${String(Date.now())}@example.com`;
  await page.goto("/auth/signup");

  // Controlled inputs reset when React hydrates; retry until values stick.
  await expect(async () => {
    await page.getByLabel("Name").fill("Smoke Test");
    await page.getByLabel("Email").fill(email);
    await page.getByLabel("Password").fill("a-long-enough-password");
    await expect(page.getByLabel("Name")).toHaveValue("Smoke Test");
    await expect(page.getByLabel("Email")).toHaveValue(email);
    await expect(page.getByLabel("Password")).toHaveValue(
      "a-long-enough-password",
    );
  }).toPass({ timeout: 15_000 });

  await page.getByRole("button", { name: "Sign up" }).click();
  await expect(page.getByText(email)).toBeVisible();
  await page.getByRole("button", { name: "Sign out" }).click();
  await expect(page.getByRole("link", { name: "Log in" })).toBeVisible();
});
