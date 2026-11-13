/**
 * The styling audit's legal capture (design 205): the published policies,
 * signed out and signed in, and the terms prompt between them. Runs only
 * in the `audit` project, while `AUDIT_SHOTS` is set.
 */
import { expect, test } from "../support/a11y";
import { signInAsKnownUser } from "../support/known-user";
import { see } from "./capture";
import { MAYA_HANDLE, MAYA_ID } from "./seed-db";

test.use({ a11yMode: "collect" });

const POLICIES = ["/privacy", "/terms", "/copyright"];

test("legal pages, signed out", async ({ page }) => {
  for (const path of POLICIES) {
    await see(page, path);
    await expect(page.locator("h1").first()).toBeVisible();
  }
});

test("terms prompt and legal pages, signed in", async ({ page }) => {
  await signInAsKnownUser(page, MAYA_ID, MAYA_HANDLE);
  for (const path of ["/feed", "/account/terms", ...POLICIES]) {
    await see(page, path);
    await expect(page.locator("h1").first()).toBeVisible();
  }
});
