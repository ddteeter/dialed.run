import { expect, test } from "@playwright/test";

/** Not part of the auth journey, so it lives outside the demo: keeping it
 *  here would put a second, unrelated video beside the one a reviewer is
 *  meant to watch. */
test("home renders the brand hero", async ({ page }) => {
  await page.goto("/");
  await expect(
    page.getByRole("heading", { name: /every run has an outfit/i }),
  ).toBeVisible();
});
