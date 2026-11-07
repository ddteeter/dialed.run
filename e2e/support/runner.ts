import { expect } from "@playwright/test";
import type { Browser, BrowserContext } from "@playwright/test";

import { confirmLinkFor } from "./email-links";
import { turnstileAnswered } from "./invites";

/**
 * A new runner, signed up through the real forms in a context of its own:
 * sign up, open the confirm link, log in, pick a handle at O0, and (unless
 * the caller wants to film it) skip onboarding through `/onboarding/done`.
 *
 * Shared by `accounts.setup.ts`, which makes the demos' fixed accounts,
 * and the walkthroughs, which each want a runner nobody else has touched
 * (design 180, step 5). Through the forms rather than seeded auth rows,
 * because minting a session would mean reproducing Better Auth's password
 * hashing and cookie format here.
 *
 * Returns the context, signed in, for the caller to save and close.
 */
export async function signUpRunner(
  browser: Browser,
  runner: Readonly<{
    baseURL: string | undefined;
    email: string;
    handle: string;
    inviteCode: string;
    finishOnboarding: boolean;
  }>,
): Promise<BrowserContext> {
  // The project's baseURL, passed in: a context a fixture creates does not
  // inherit it.
  const context = await browser.newContext(
    runner.baseURL === undefined ? {} : { baseURL: runner.baseURL },
  );
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
      await page.getByLabel("Invite code").fill(runner.inviteCode);
      await page.getByLabel("Date of birth").fill("1990-04-21");
      await turnstileAnswered(page);
    }
    await page.getByLabel("Email").fill(runner.email);
    await page.getByLabel("Password").fill("a-long-enough-password");
    await page.getByRole("button", { name: submit }).click();
    if (path !== "/auth/signup") {
      continue;
    }

    await expect(page).toHaveURL(/\/account\/check-email/, {
      timeout: 15_000,
    });
    await page.goto(await confirmLinkFor(runner.email));
    await expect(
      page.getByRole("heading", { name: "Email confirmed" }),
    ).toBeVisible({ timeout: 15_000 });
  }

  // A new account picks its handle at O0 first (round 26 #7), through
  // the real form — the same path every runner takes, so the demos'
  // `@handle`s are ones the rule and the reserved list accepted.
  await expect(page).toHaveURL(/\/onboarding\/handle/, { timeout: 15_000 });
  await page
    .locator('html[data-hydrated="true"]')
    .waitFor({ state: "attached" });
  await page.getByRole("textbox", { name: "Username" }).fill(runner.handle);
  await page.getByRole("button", { name: "Next" }).click();

  // Then O1 (R-52), and `/` sends it back here until
  // `onboarding_complete` is set. `/onboarding/done` is the route that
  // sets it — the same one P3 uses, rather than a hand-written upsert that
  // could drift from it.
  await expect(page).toHaveURL(/\/onboarding\/calibrate/, {
    timeout: 15_000,
  });
  if (runner.finishOnboarding) {
    await page.goto("/onboarding/done");
    await expect(
      page.getByRole("heading", { name: "Now go run." }),
    ).toBeVisible({ timeout: 15_000 });
  }
  await page.close();
  return context;
}
