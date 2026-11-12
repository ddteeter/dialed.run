import { eq, sql } from "drizzle-orm";

import { userProfiles } from "../../src/db/schema-core";
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
