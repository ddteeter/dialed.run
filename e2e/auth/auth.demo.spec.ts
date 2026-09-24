/**
 * Covers: Au1 (create account), Au3 (wrong password), Au2 (log in), sign
 * out from the settings index — one journey, one video.
 *
 * Exactly one test() per demo spec. A second test here would record a
 * second video beside the one the reviewer is meant to watch; standalone
 * assertions belong in a sibling *.spec.ts (see home.spec.ts).
 */
import { expect, scene, test } from "../support/demo";

/** Layout stamps html[data-hydrated] once React attaches; driving
 *  controlled inputs before that races hydration's state reset. */
async function hydrated(page: import("@playwright/test").Page): Promise<void> {
  await page
    .locator('html[data-hydrated="true"]')
    .waitFor({ state: "attached" });
}

/**
Not a secret: a throwaway account on the local dev database.
*/
const PASSPHRASE = ["a", "long", "enough", "passphrase"].join("-");

test("create an account -> sign out -> a wrong password -> log in", async ({
  page,
}, testInfo) => {
  testInfo.setTimeout(150_000);
  const email = `smoke-${String(Date.now())}@example.com`;
  await page.goto("/auth/signup");
  await hydrated(page);

  await scene(page, "Au1 · Create account, with no tab bar");
  await expect(
    page.getByRole("heading", { name: "Create account" }),
  ).toBeVisible();
  await expect(page.locator("[data-slot='tab-bar']")).toHaveCount(0);
  await page.getByLabel("Name").fill("Smoke Test");
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill(PASSPHRASE);
  await page.getByRole("button", { name: "Show" }).click();
  await expect(page.getByLabel("Password")).toHaveAttribute("type", "text");
  await page.getByRole("button", { name: "Create account" }).click();

  // A new account lands in onboarding (D-52); the close screen's own link
  // is the way a runner first leaves it.
  await scene(page, "A new account lands in onboarding");
  await expect(page).toHaveURL(/\/onboarding\/calibrate/u, { timeout: 15_000 });
  await page.goto("/onboarding/done");
  await page.getByRole("link", { name: "Done for now" }).click();

  // Sign out lives at the foot of the settings index now (U1).
  await scene(page, "Sign out, from the foot of settings");
  await page.goto("/onboarding/settings");
  await hydrated(page);
  await page.getByRole("button", { name: "Sign out" }).click();
  await expect(page).toHaveURL(/\/$/u, { timeout: 15_000 });
  await expect(
    page.getByRole("link", { name: "Create account" }),
  ).toBeVisible();

  await scene(page, "Au3 · a wrong password is marked on Password");
  await page.goto("/auth/login");
  await hydrated(page);
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill(`${PASSPHRASE}-not`);
  await page.getByRole("button", { name: "Log in" }).click();
  await expect(
    page.getByText("That password doesn't match this email."),
  ).toBeVisible({ timeout: 15_000 });
  await expect(page.getByRole("status")).toHaveText(
    "Not signed in. One field needs a fix.",
  );

  await scene(page, "Au2 · the right one logs in");
  await page.getByLabel("Password").fill(PASSPHRASE);
  await page.getByRole("button", { name: "Log in" }).click();
  await expect(page).not.toHaveURL(/\/auth\//u, { timeout: 15_000 });
});
