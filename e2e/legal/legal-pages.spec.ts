import { expect, test } from "../support/a11y";

/**
 * The legal pages, signed out: the a11y fixture checks each one's final
 * state, and plan 161's route check counts them as visited.
 */
for (const path of ["/privacy", "/terms", "/copyright"]) {
  test(`${path} renders for anyone`, async ({ page }) => {
    await page.goto(path);
    await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
  });
}
