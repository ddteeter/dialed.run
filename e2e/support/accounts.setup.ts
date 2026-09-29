import { mkdirSync, writeFileSync } from "node:fs";

import { expect, test as setup } from "@playwright/test";

import { DEMO_ACCOUNTS, storageStateFor } from "./accounts";
import { confirmLinkFor } from "./email-links";
import { ensureInviteCode, turnstileAnswered } from "./invites";

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
 * context, so no session leaks from one to the next.
 *
 * **Sign-up signs nobody in, and ends on Au4** (round 26 #11), so each
 * account opens its confirm link — the feed and verdict demos need runners
 * whose entries can be public (decision D-50) — and then logs in.
 */
const AUTH_DIR = "node_modules/.cache/dialed-demo-auth";

/**
 * A handle for this run's account: the demo's name, underscored, and the
 * run's last digits so a second run on the same local database is free —
 * old handles are never reclaimable (round 26 #7).
 */
function demoHandle(account: string, suffix: string): string {
  return `${account.replace("-", "_")}_${suffix.slice(-6)}`;
}

setup("create the demo accounts", async ({ browser }, testInfo) => {
  // Five signups through a real browser, serially. Nothing here is paced —
  // the setup project is not the demo project — but it is still five round
  // trips through Better Auth.
  testInfo.setTimeout(120_000);
  mkdirSync(AUTH_DIR, { recursive: true });
  const suffix = String(Date.now());
  const accounts: Record<string, string> = {};
  // Sign-up is invite-only (task 126, ACC-5): the harness's own code.
  const inviteCode = await ensureInviteCode();

  for (const account of DEMO_ACCOUNTS) {
    const email = `${account}-${suffix}@example.com`;
    const context = await browser.newContext();
    const page = await context.newPage();

    // Sign up, open the confirm link, then log in: the same two fields
    // on both forms, submitted by each form's own button.
    for (const [path, submit] of [
      ["/auth/signup", "Create account"],
      ["/auth/login", "Log in"],
    ] as const) {
      await page.goto(path);
      await page
        .locator('html[data-hydrated="true"]')
        .waitFor({ state: "attached" });
      if (path === "/auth/signup") {
        await page.getByLabel("Invite code").fill(inviteCode);
        await turnstileAnswered(page);
      }
      await page.getByLabel("Email").fill(email);
      await page.getByLabel("Password").fill("a-long-enough-password");
      await page.getByRole("button", { name: submit }).click();
      if (path === "/auth/signup") {
        await expect(page).toHaveURL(/\/account\/check-email/, {
          timeout: 15_000,
        });
        await page.goto(await confirmLinkFor(email));
        await expect(
          page.getByRole("heading", { name: "Email confirmed" }),
        ).toBeVisible({ timeout: 15_000 });
      }
    }

    // A new account picks its handle at O0 first (round 26 #7), through
    // the real form — the same path every runner takes, so the demos'
    // `@handle`s are ones the rule and the reserved list accepted.
    await expect(page).toHaveURL(/\/onboarding\/handle/, { timeout: 15_000 });
    await page
      .locator('html[data-hydrated="true"]')
      .waitFor({ state: "attached" });
    await page
      .getByRole("textbox", { name: "Username" })
      .fill(demoHandle(account, suffix));
    await page.getByRole("button", { name: "Next" }).click();

    // Then O1 (D-52), and `/` sends it back here until
    // `onboarding_complete` is set. Every demo but `onboarding` wants to
    // start past that, and `/onboarding/done` is the route that sets it —
    // the same one P3 uses, rather than a hand-written upsert that could
    // drift from it.
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
