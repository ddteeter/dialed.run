import { expect, test } from "../support/a11y";
import { storageStateFor } from "../support/accounts";

/**
 * Settings › Username, opened and left unchanged: the a11y fixture
 * checks the screen, and nothing here renames the account.
 */
test.use({ storageState: storageStateFor("closet") });

test("the username screen shows the current handle", async ({ page }) => {
  await page.goto("/account/username");
  await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
  await expect(page.getByRole("textbox")).not.toHaveValue("");
});
