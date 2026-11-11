/**
 * Covers, beside `feed.journey.spec.ts`: the smoke account is invisible to
 * runners (design 193, #533; owner, 2026-11-09). A runner who searches for
 * it, opens its runner page or visits its open-web profile signed out
 * finds nothing, even with the profile set public. The worker suite proves
 * each read. This spec proves the pages a runner actually meets, which
 * only a real server and browser render: H's "isn't here", H by id's
 * redirect, and the open web's 404.
 *
 * The flag is set by SQL, as the owner sets it in production; no app code
 * writes it. The test seeds the account with an id it generated and
 * removes exactly that.
 */
import { eq } from "drizzle-orm";

import { userProfiles } from "../../src/db/schema-core";
import { removeSeeded, seedRunner, seeded } from "../conformance/feed-support";
import { storageStateFor } from "../support/accounts";
import { expect, test } from "../support/a11y";
import { hydrated } from "../support/demo";
import { withLocalDb } from "../support/local-db";

test.use({ storageState: storageStateFor("feed") });

test("a runner can't find the smoke account: not in search, not at H, not on the open web", async ({
  page,
}) => {
  const rows = seeded();
  const handle = `smoke_${String(Date.now()).slice(-8)}`;
  const smokeId = await seedRunner(rows, handle);
  await withLocalDb(async ({ core }) => {
    await core
      .update(userProfiles)
      // Public, so the system mark is the only thing hiding it.
      .set({ publicProfile: true, systemAccount: true })
      .where(eq(userProfiles.userId, smokeId));
  });
  try {
    await page.goto("/feed/search");
    await hydrated(page);
    await page.getByPlaceholder("Search by name").fill(handle);
    const nobody = `No runner called @${handle}.`;
    await expect(
      page.getByRole("status").filter({ hasText: nobody }),
    ).toHaveText(nobody);

    // H by handle says what a gone runner's says, and H by id sends the
    // viewer back to the feed, as for any runner they may not see.
    await page.goto(`/feed/u/${handle}`);
    await hydrated(page);
    await expect(page.getByText("This runner isn't here.")).toBeVisible();
    await expect(page.getByText(`@${handle}`)).toHaveCount(0);
    await page.goto(`/feed/u/${smokeId}`);
    await expect(page).toHaveURL(/\/feed$/u);
    await expect(page.getByText(`@${handle}`)).toHaveCount(0);

    await page.context().clearCookies();
    const openWeb = await page.goto(`/@${handle}`);
    expect(openWeb?.status()).toBe(404);
    await hydrated(page);
    await expect(
      page.getByRole("heading", {
        level: 1,
        name: "Nothing to see at this link",
      }),
    ).toBeVisible();
    await expect(page.getByText(`@${handle}`)).toHaveCount(0);
  } finally {
    await removeSeeded(rows);
  }
});
