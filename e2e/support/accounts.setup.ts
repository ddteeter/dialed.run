import { mkdirSync, writeFileSync } from "node:fs";

import { expect, test as setup } from "@playwright/test";

import { DEMO_ACCOUNTS, storageStateFor } from "./accounts";

/**
 * Creates every demo's account and saves its session, before any demo runs.
 *
 * **It drives the real signup UI rather than seeding auth rows.** Minting a
 * session directly would mean reproducing Better Auth's password hashing
 * and its signed-cookie format in a test helper — coupling this harness to
 * an internal that can change under it without a word. Signing up through
 * the form knows nothing, and costs a few seconds in a project that
 * records no video.
 *
 * **One test, not one per account**, so the accounts file is written once
 * with no read-modify-write race. It writes under `node_modules`, because
 * Vite watches the source tree and a mid-run write there hot-reloads the
 * app out from under a running demo — see `./accounts.ts`. Each account gets its own browser
 * context, because signing up logs you in and the next one needs a clean
 * slate.
 */
const AUTH_DIR = "node_modules/.cache/dialed-demo-auth";

setup("create the demo accounts", async ({ browser }, testInfo) => {
  // Five signups through a real browser, serially. Nothing here is paced —
  // the setup project is not the demo project — but it is still five round
  // trips through Better Auth.
  testInfo.setTimeout(120_000);
  mkdirSync(AUTH_DIR, { recursive: true });
  const suffix = String(Date.now());
  const accounts: Record<string, string> = {};

  for (const account of DEMO_ACCOUNTS) {
    const email = `${account}-${suffix}@example.com`;
    const context = await browser.newContext();
    const page = await context.newPage();

    await page.goto("/auth/signup");
    await page
      .locator('html[data-hydrated="true"]')
      .waitFor({ state: "attached" });
    await page.getByLabel("Name").fill("Demo Runner");
    await page.getByLabel("Email").fill(email);
    await page.getByLabel("Password").fill("a-long-enough-password");
    await page.getByRole("button", { name: "Sign up" }).click();

    // A new account lands in O1 now (D-52), and `/` sends it back here
    // until `onboarding_complete` is set. Every demo but `onboarding`
    // wants to start past that, and `/onboarding/done` is the route that
    // sets it — the same one P3 uses, rather than a hand-written upsert
    // that could drift from it.
    await expect(page).toHaveURL(/\/onboarding\/calibrate/, {
      timeout: 15_000,
    });
    if (account !== "onboarding") {
      await page.goto("/onboarding/done");
      await expect(
        page.getByRole("heading", { name: "Now go run." }),
      ).toBeVisible({ timeout: 15_000 });
    }

    await context.storageState({ path: storageStateFor(account) });
    await context.close();
    accounts[account] = email;
  }

  writeFileSync(
    `${AUTH_DIR}/accounts.json`,
    `${JSON.stringify(accounts, undefined, 2)}\n`,
  );
});
