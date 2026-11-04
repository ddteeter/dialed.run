import { expect, test } from "../support/a11y";

/**
 * The legal pages, signed out, so the a11y fixture checks each one and
 * plan 161's route check counts it visited. Until the owner marks a text
 * published (`modules/account/legal.ts`), its page is the not-found
 * state; either way it has one level-1 heading.
 */
for (const path of ["/privacy", "/terms", "/copyright"]) {
  test(`${path} answers anyone with a page`, async ({ page }) => {
    await page.goto(path);
    await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
  });
}
