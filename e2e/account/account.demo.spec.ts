/**
 * Covers: Settings › Account (ACC-7, ACC-8), Change password, Settings ›
 * Notifications (ACC-11), the unsubscribe link and its landing (round 26
 * #19), and Sign out everywhere — one journey, one video.
 *
 * Exactly one test() per demo spec (see e2e/auth/auth.demo.spec.ts).
 */
import type { Page } from "@playwright/test";

import { expect, scene, test } from "../support/demo";
import { confirmLinkFor, unsubscribeLinkFor } from "../support/email-links";

async function hydrated(page: Page): Promise<void> {
  await page
    .locator('html[data-hydrated="true"]')
    .waitFor({ state: "attached" });
}

/**
Not a secret: a throwaway account on the local dev database.
*/
const PASSPHRASE = ["an", "account", "demo", "passphrase"].join("-");

test("account settings -> change password -> reminder emails off and on -> sign out everywhere", async ({
  page,
}, testInfo) => {
  testInfo.setTimeout(150_000);
  const email = `account-${String(Date.now())}@example.com`;

  // A confirmed runner with a handle, the way the auth demo makes one.
  await page.goto("/auth/signup");
  await hydrated(page);
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill(PASSPHRASE);
  await page.getByRole("button", { name: "Create account" }).click();
  await expect(page).toHaveURL(/\/account\/check-email/u, { timeout: 15_000 });
  await page.goto(await confirmLinkFor(email));
  await expect(
    page.getByRole("heading", { name: "Email confirmed" }),
  ).toBeVisible({ timeout: 15_000 });
  await page.goto("/auth/login");
  await hydrated(page);
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill(PASSPHRASE);
  await page.getByRole("button", { name: "Log in" }).click();
  await expect(page).toHaveURL(/\/onboarding\/handle/u, { timeout: 15_000 });
  await hydrated(page);
  await page
    .getByRole("textbox", { name: "Username" })
    .fill(`acct_${String(Date.now()).slice(-8)}`);
  await page.getByRole("button", { name: "Next" }).click();
  await expect(page).toHaveURL(/\/onboarding\/calibrate/u, { timeout: 15_000 });

  await scene(
    page,
    "Settings › Account: the address, the handle, the password",
  );
  await page.goto("/onboarding/settings");
  await hydrated(page);
  await page.getByRole("link", { name: /^Account/u }).click();
  await expect(page).toHaveURL(/\/account\/sign-in/u, { timeout: 15_000 });
  await hydrated(page);
  await expect(page.getByRole("link", { name: /^Email/u })).toContainText(
    email,
  );

  await scene(page, "Change password: the current one, then the new one");
  await page.getByRole("link", { name: /^Password/u }).click();
  await expect(page.getByRole("heading", { name: "Password" })).toBeVisible();
  await page.getByLabel("Current password").fill(PASSPHRASE);
  await page.getByLabel("New password").fill(`${PASSPHRASE}-2`);
  await page.getByRole("button", { name: "Change password" }).click();
  await expect(page.locator("form").getByRole("status")).toHaveText(
    "Password changed. Every other device was signed out.",
    { timeout: 15_000 },
  );

  await scene(
    page,
    "Settings › Notifications: only the run reminder can email",
  );
  await page.goto("/account/notifications");
  await hydrated(page);
  await expect(page.getByText("Always sent")).toBeVisible();
  await expect(page.getByRole("checkbox", { name: "Email" })).toBeChecked();

  // The link in every reminder's footer, opened from the inbox
  // (e2e/support/email-links): opening it asks, and changes nothing until
  // its one button is pressed (D-64 — scanners open every link).
  await scene(page, "The email's unsubscribe link: no log-in, one button");
  await page.goto(await unsubscribeLinkFor(email));
  await expect(
    page.getByRole("heading", { name: "Stop run reminder emails?" }),
  ).toBeVisible({ timeout: 15_000 });
  await hydrated(page);
  await page.getByRole("button", { name: "Unsubscribe" }).click();
  await expect(
    page.getByRole("heading", { name: "Run reminder emails are off" }),
  ).toBeVisible({ timeout: 15_000 });
  // A second visit shows the done state (round 27 #8); turning them back
  // on returns to the question.
  await page.reload();
  await expect(
    page.getByRole("heading", { name: "Run reminder emails are off" }),
  ).toBeVisible({ timeout: 15_000 });
  await hydrated(page);
  await page.getByRole("button", { name: "Turn them back on" }).click();
  await expect(
    page.getByRole("heading", { name: "Stop run reminder emails?" }),
  ).toBeVisible({ timeout: 15_000 });

  await scene(page, "Sign out everywhere");
  await page.goto("/account/sign-in");
  await hydrated(page);
  await page.getByRole("button", { name: "Sign out everywhere" }).click();
  await expect(page).toHaveURL(/\/$/u, { timeout: 15_000 });
  await page.goto("/call");
  await expect(page).toHaveURL(/\/auth\/login/u, { timeout: 15_000 });
});
