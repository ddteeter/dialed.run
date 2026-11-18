import { eq, sql } from "drizzle-orm";

import { userProfiles, usernameHistory } from "../../src/db/schema-core";
import { nowSeconds } from "../../src/lib/now";
import { expect, test } from "../support/a11y";
import { storageStateFor } from "../support/accounts";
import { PHONE } from "../support/bars";
import { hydrated } from "../support/conformance";
import { signInAsKnownUser } from "../support/known-user";
import { withLocalDb } from "../support/local-db";

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

/**
 * O0, the same question as onboarding's first step, which only a runner
 * with no handle is shown (round 26 #7). It ends here, at the phone's
 * width, so what a screen reader says on it is checked in (#582).
 */
test.describe("a runner with no handle yet", () => {
  test.use({ storageState: { cookies: [], origins: [] }, viewport: PHONE });

  const NEW_RUNNER = "e2e-no-handle";

  test("O0: anywhere they go, they are asked for a username first", async ({
    page,
  }) => {
    await signInAsKnownUser(page, NEW_RUNNER, "no_handle_yet");
    await withLocalDb(async ({ core }) => {
      await core
        .update(userProfiles)
        .set({ username: sql`NULL` })
        .where(eq(userProfiles.userId, NEW_RUNNER));
    });

    await page.goto("/");
    await expect(page).toHaveURL(/\/onboarding\/handle/u, { timeout: 15_000 });
    await hydrated(page);
    await expect(page.getByRole("textbox", { name: "Username" })).toHaveValue(
      "",
    );
    await expect(page.getByRole("button", { name: "Next" })).toBeVisible();
  });
});

/**
 * Past the rename cap (R60, #820): no edit to the field fixes it, so it is
 * the band above Save, NOT CHANGED with the day, and no Try again.
 */
test.describe("a runner who has changed their handle three times this month", () => {
  test.use({ storageState: { cookies: [], origins: [] } });

  const RENAMER = "e2e-rename-cap";

  test("Save is refused in the band above it, naming the day", async ({
    page,
  }) => {
    await signInAsKnownUser(page, RENAMER, "cap_current");
    await withLocalDb(async ({ core }) => {
      await core
        .delete(usernameHistory)
        .where(eq(usernameHistory.userId, RENAMER));
      const now = nowSeconds();
      await core.insert(usernameHistory).values(
        ["cap_one", "cap_two", "cap_three"].map((username) => ({
          username,
          userId: RENAMER,
          retiredAt: now - 60,
        })),
      );
    });

    await page.goto("/account/username");
    await hydrated(page);
    const field = page.getByRole("textbox", { name: "Username" });
    await field.fill("cap_fourth");
    await page.getByRole("button", { name: "Save" }).click();

    const band = page.locator("[data-part=failure-band]");
    await expect(band).toContainText("Not changed");
    await expect(band).toContainText(
      /You've changed your handle 3 times in 30 days\. You can change it again on /u,
    );
    await expect(page.getByRole("button", { name: "Try again" })).toHaveCount(
      0,
    );
    await expect(field).not.toHaveAttribute("aria-invalid", "true");
  });
});
