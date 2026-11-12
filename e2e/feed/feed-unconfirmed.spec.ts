/**
 * Covers, beside `feed.journey.spec.ts`: the unconfirmed runner's band on
 * Feed and You and the "Confirm your email first" sheet that the server's
 * refusal of Useful, Report and Follow opens (round 26 #11; FEED-11,
 * SAF-15; design 133, D-113 Q3) while Unfollow goes through, and an
 * unconfirmed runner nobody can find in search (D-113 Q2).
 *
 * Each test seeds the rows it reads, with ids it generated, and removes
 * exactly those: the feed account is the journey's too, and its address
 * is always confirmed again before the test ends.
 */
import { eq } from "drizzle-orm";

import { user } from "../../src/db/schema-auth";
import { reactions } from "../../src/db/schema-core";
import { nowSeconds } from "../../src/lib/now";
import {
  feedUserId,
  removeSeeded,
  seedRunner,
  seeded,
} from "../conformance/feed-support";
import { storageStateFor } from "../support/accounts";
import { expect, test } from "../support/a11y";
import { PHONE, bar } from "../support/bars";
import { hydrated } from "../support/demo";
import { withLocalDb } from "../support/local-db";
import { seedFollowedPost } from "./followed-runner";

test.use({ storageState: storageStateFor("feed") });

/**
 * A runner's address, confirmed or not (round 26 #11): the feed runner's
 * is flipped for the unconfirmed beats and always flipped back, because
 * every later spec in the run signs in as a confirmed runner.
 */
async function setEmailConfirmed(
  userId: string,
  isConfirmed: boolean,
): Promise<void> {
  await withLocalDb(async ({ core }) => {
    await core
      .update(user)
      .set({ emailVerified: isConfirmed })
      .where(eq(user.id, userId));
  });
}

test("unconfirmed: Useful, Report and Follow open Confirm first, and Unfollow goes through", async ({
  page,
}) => {
  const rows = seeded();
  const viewerId = await feedUserId();
  const { username, entryId } = await seedFollowedPost(rows, viewerId);
  // The mark the runner left while their address was confirmed.
  await withLocalDb(({ core }) =>
    core
      .insert(reactions)
      .values({ entryId, userId: viewerId, createdAt: nowSeconds() }),
  );
  // One hairline band on Feed and You, and Useful and Report draw at full
  // strength and ask the server, whose refusal opens "Confirm your email
  // first".
  await setEmailConfirmed(viewerId, false);
  try {
    await page.goto(`/feed/entry/${entryId}`);
    await hydrated(page);
    await page.getByRole("button", { name: "Report this entry" }).click();
    const reportSheet = page.getByRole("dialog", { name: /^Report /u });
    await expect(reportSheet).toBeVisible();
    await reportSheet
      .getByRole("radio", { name: "It's an ad, or it's spam" })
      .click();
    await reportSheet.getByRole("button", { name: "Send report" }).click();
    const confirmFirst = page.getByRole("dialog", {
      name: "Confirm your email first",
    });
    await expect(confirmFirst).toBeVisible();
    await expect(confirmFirst).toContainText(
      "Reporting needs a confirmed email.",
    );
    await confirmFirst.getByRole("button", { name: "Not now" }).click();
    await expect(confirmFirst).toBeHidden();
    // Nothing was filed, and W1 says nothing of the kind: it is as it was.
    await expect(page.getByText("Report sent.")).toHaveCount(0);
    await expect(reportSheet).toBeVisible();
    await reportSheet.getByRole("button", { name: "Close" }).click();
    await expect(reportSheet).toBeHidden();

    // One band at the top of Feed.
    await bar(page).getByRole("link", { name: "Feed" }).click();
    await expect(page.getByRole("heading", { name: "Feed" })).toBeVisible();
    await hydrated(page);
    const nag = page.getByRole("complementary", {
      name: "Confirm your email",
    });
    await expect(nag).toContainText(
      "Confirm your email to share runs with other runners.",
    );
    await expect(
      nag.getByRole("button", { name: "Resend link" }),
    ).toBeVisible();

    // Useful is refused, and nothing changes.
    const cardUseful = page
      .locator('[data-part="post"]')
      .filter({ hasText: `@${username}` })
      .getByRole("button", { name: /Useful/u });
    await cardUseful.click();
    await expect(confirmFirst).toBeVisible();
    await expect(confirmFirst).toContainText(
      "Marking runs Useful needs a confirmed email.",
    );
    await expect(
      confirmFirst.getByRole("button", { name: "Not now" }),
    ).toBeFocused();
    await confirmFirst.getByRole("button", { name: "Not now" }).click();
    await expect(confirmFirst).toBeHidden();
    // Still the mark the confirmed runner left: nothing was sent.
    await expect(cardUseful).toHaveAttribute("aria-pressed", "true");
    await expect(cardUseful).toContainText("1");

    // The same band on You.
    await bar(page).getByRole("link", { name: "You" }).click();
    await expect(page.locator('[data-part="settings-button"]')).toBeVisible();
    await expect(nag).toBeVisible();

    // Follow is a count other runners see, so it waits too; Unfollow only
    // takes one away, so it does not (D-113 Q3). The sheet leads with
    // round 35 #49's sentence.
    await page.goto(`/feed/u/${username}`);
    await hydrated(page);
    await page.getByRole("button", { name: "Following" }).click();
    const follow = page.getByRole("button", { name: "Follow" });
    await expect(follow).toBeVisible();
    await follow.click();
    await expect(confirmFirst).toBeVisible();
    await expect(confirmFirst).toContainText("We sent a link to");
    await expect(confirmFirst).toContainText(
      "Following runners needs a confirmed email.",
    );
    await confirmFirst.getByRole("button", { name: "Not now" }).click();
    await expect(confirmFirst).toBeHidden();
    // Nothing changed and nothing failed: the pill is as it was.
    await expect(follow).toBeVisible();
    await expect(page.getByText("Not following")).toHaveCount(0);
  } finally {
    await setEmailConfirmed(viewerId, true);
  }

  try {
    // Confirmed again, the same press goes through.
    await page.reload();
    await hydrated(page);
    await page.getByRole("button", { name: "Follow" }).click();
    await expect(page.getByRole("button", { name: "Following" })).toBeVisible();
  } finally {
    await withLocalDb(({ core }) =>
      core.delete(reactions).where(eq(reactions.entryId, entryId)),
    );
    await removeSeeded(rows);
  }
});

test("search never finds a runner who has not confirmed their address", async ({
  page,
}) => {
  // A runner who has claimed a handle and not confirmed their address yet:
  // nobody finds them until they do (design 133, D-113 Q2).
  const rows = seeded();
  const waitingUsername = `wait_${String(Date.now()).slice(-8)}`;
  const waitingUserId = await seedRunner(rows, waitingUsername);
  await setEmailConfirmed(waitingUserId, false);
  try {
    await page.goto("/feed/search");
    await hydrated(page);
    await page.getByPlaceholder("Search by name").fill(waitingUsername);
    // Drawn under the field, and said by the screen's one status region.
    const nobody = `No runner called @${waitingUsername}.`;
    await expect(
      page.getByRole("paragraph").filter({ hasText: nobody }),
    ).toBeVisible();
    await expect(
      page.getByRole("status").filter({ hasText: nobody }),
    ).toHaveText(nobody);
  } finally {
    await removeSeeded(rows);
  }
});

// The other side of the rule, at the phone's width: a confirmed runner is
// found. It ends on the result so what a screen reader is given for a hit
// is checked in (#582).
test("search finds a runner who has confirmed, as a row with Follow", async ({
  page,
}) => {
  const rows = seeded();
  const username = `found_${String(Date.now()).slice(-8)}`;
  await seedRunner(rows, username);
  try {
    await page.setViewportSize(PHONE);
    await page.goto("/feed/search");
    await hydrated(page);
    await page.getByPlaceholder("Search by name").fill(username);

    const row = page.getByRole("listitem").filter({ hasText: username });
    await expect(row.getByRole("link", { name: username })).toBeVisible();
    await expect(row.getByRole("button", { name: "Follow" })).toBeVisible();
  } finally {
    await removeSeeded(rows);
  }
});
