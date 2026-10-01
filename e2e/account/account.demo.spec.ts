/**
 * Covers: Settings › Account (ACC-7, ACC-8), Change password, Settings ›
 * Notifications (ACC-11), the unsubscribe link and its landing (round 26
 * #19), Sign out everywhere, Export your data (ACC-10: Get a copy, Preparing,
 * the queued ZIP, Download), and Delete account
 * with Keep inside the week (ACC-9; round 27 #14) — one journey, one video.
 *
 * Exactly one test() per demo spec (see e2e/auth/auth.demo.spec.ts).
 */
import type { Page } from "@playwright/test";

import { expect, scene, test } from "../support/demo";
import { confirmLinkFor, unsubscribeLinkFor } from "../support/email-links";
import { ensureInviteCode, turnstileAnswered } from "../support/invites";

async function hydrated(page: Page): Promise<void> {
  await page
    .locator('html[data-hydrated="true"]')
    .waitFor({ state: "attached" });
}

/**
Not a secret: a throwaway account on the local dev database.
*/
const PASSPHRASE = ["an", "account", "demo", "passphrase"].join("-");

test("account settings -> change password -> reminder emails off and on -> sign out everywhere -> export -> delete and keep", async ({
  page,
}, testInfo) => {
  testInfo.setTimeout(420_000);
  const email = `account-${String(Date.now())}@example.com`;

  // A confirmed runner with a handle, the way the auth demo makes one.
  await page.goto("/auth/signup");
  await hydrated(page);
  await page.getByLabel("Invite code").fill(await ensureInviteCode());
  await turnstileAnswered(page);
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

  // Back in, with the password changed above.
  await logIn(page, email, `${PASSPHRASE}-2`);

  await scene(
    page,
    "Export your data: Get a copy, and it's Preparing (ACC-10)",
  );
  await page.goto("/account/sign-in");
  await expect(page.getByRole("heading", { name: "Account" })).toBeVisible({
    timeout: 15_000,
  });
  await hydrated(page);
  const exportRow = page.locator("[data-part='export-row']");
  await exportRow.getByRole("button", { name: "Get a copy" }).click();
  // Preparing — or already past it. `dialed-exports` hands its consumer one
  // job at a time with no batch wait (decision D-86), so the local stack
  // can finish a new account's small ZIP before the row reloads.
  await expect(
    exportRow
      .getByText("We'll email a link when it's ready.")
      .or(exportRow.getByRole("link", { name: "Download" })),
  ).toBeVisible({ timeout: 15_000 });

  // The queued build runs in the local stack's own consumer; the email
  // goes to the local send_email binding. What the page shows once it has
  // run is the day's copy, offered here as well as by email.
  await scene(page, "The ZIP is built and emailed; today the row offers it");
  await expect(async () => {
    await page.reload();
    await expect(exportRow.getByRole("link", { name: "Download" })).toBeVisible(
      { timeout: 2000 },
    );
  }).toPass({ timeout: 60_000 });
  await expect(exportRow).toContainText("Emailed. The link works until");
  await hydrated(page);
  const download = page.waitForEvent("download");
  await exportRow.getByRole("link", { name: "Download" }).click();
  const file = await download;
  expect(file.suggestedFilename()).toMatch(
    /^dialed-run-export-\d{4}-\d{2}-\d{2}\.zip$/u,
  );

  await scene(page, "Delete account: the password once more, then 7 days");
  await page.getByRole("button", { name: /^Delete account/u }).click();
  const sheet = page.getByRole("dialog", { name: "Delete your account?" });
  await expect(sheet).toBeVisible();
  await sheet.getByLabel("Current password").fill(`${PASSPHRASE}-2`);
  await sheet.getByRole("button", { name: "Delete my account" }).click();
  await expect(
    page.getByRole("heading", { name: /^Your account goes on /u }),
  ).toBeVisible({ timeout: 15_000 });
  await expect(page.getByText("Deletion scheduled")).toBeVisible();
  // Signed out on every device.
  await page.goto("/call");
  await expect(page).toHaveURL(/\/auth\/login/u, { timeout: 15_000 });

  await scene(page, "Logging in inside the week asks: keep it?");
  await logIn(page, email, `${PASSPHRASE}-2`);
  await expect(
    page.getByRole("heading", { name: "Keep your account?" }),
  ).toBeVisible({ timeout: 15_000 });
  await hydrated(page);
  // Every page asks first; nothing is cancelled silently.
  await page.goto("/onboarding/settings");
  await expect(
    page.getByRole("heading", { name: "Keep your account?" }),
  ).toBeVisible({ timeout: 15_000 });
  await hydrated(page);
  // Keep brings everything back but Strava, and says so.
  await expect(
    page.getByText(
      "Strava is disconnected, and stays that way until you connect it again.",
    ),
  ).toBeVisible();
  await page.getByRole("button", { name: "Keep my account" }).click();
  // Kept: back into the app (this runner lands on onboarding, which the
  // demo skipped), and never asked again.
  await expect(page).not.toHaveURL(/\/account\/leaving/u, {
    timeout: 15_000,
  });
  await page.goto("/onboarding/settings");
  await expect(page.getByRole("link", { name: /^Account/u })).toBeVisible({
    timeout: 15_000,
  });
});

async function logIn(page: Page, email: string, password: string) {
  await page.goto("/auth/login");
  await expect(page.getByRole("heading", { name: "Log in" })).toBeVisible({
    timeout: 15_000,
  });
  await hydrated(page);
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill(password);
  await page.getByRole("button", { name: "Log in" }).click();
  await expect(page).not.toHaveURL(/\/auth\/login/u, { timeout: 15_000 });
}
