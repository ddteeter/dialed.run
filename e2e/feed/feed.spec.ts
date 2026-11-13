/**
 * Covers, beside `feed.journey.spec.ts`: the author's own under-review
 * entry marked `[UNDER REVIEW]` on the card, first on G's Recent entries
 * row (round 35 #53b) and with HIDDEN WHILE WE CHECK on D (FEED-6, D-67;
 * round 28 #6, round 29 #4), posts divided by a hairline, not a gutter
 * (round 40 C5b), a runner taking back their own entry — one photo by the
 * remove glyph on it, then the whole entry from under YOURS (task 128 ·
 * SAF-3; round 27 #26) — `/feed/u/old` saying the runner changed their
 * name (FEED-10) and a never-held `/feed/u/<handle>` saying "This runner
 * isn't here." (round 28 #11), and the shell at both widths (task 115).
 * The unconfirmed runner is `feed-unconfirmed.spec.ts`'s.
 *
 * Each test seeds the rows it reads, with ids it generated, and removes
 * exactly those: the feed account is the journey's too.
 */
import { eq } from "drizzle-orm";

import { entryPhotos, usernameHistory } from "../../src/db/schema-core";
import { newUlid } from "../../src/lib/ids";
import { nowSeconds } from "../../src/lib/now";
import {
  feedUserId,
  removeSeeded,
  seedEntry,
  seedRunner,
  seeded,
} from "../conformance/feed-support";
import type { Seeded } from "../conformance/feed-support";
import { storageStateFor } from "../support/accounts";
import { expect, test } from "../support/a11y";
import { DESK, PHONE, bar, launcher } from "../support/bars";
import { hydrated } from "../support/demo";
import { withLocalDb } from "../support/local-db";
import { putSamplePhotos } from "../support/media";
import { RUNNER_PLACE, seedFollowedPost } from "./followed-runner";

test.use({ storageState: storageStateFor("feed") });

/**
 * The feed runner's own shared entry with two photos, in storage as well
 * as in the table, so the card has a "1 / 2" and D has two to take back.
 */
async function seedOwnEntry(
  rows: Seeded,
  ownerId: string,
  params: { isUnderReview: boolean },
): Promise<string> {
  const { entryId } = await seedEntry(rows, {
    userId: ownerId,
    place: RUNNER_PLACE,
    startedAt: nowSeconds() - 7200,
    verdict: 0,
    moderationStatus: params.isUnderReview ? "hidden_pending_review" : "ok",
  });
  const photoIds = [newUlid(), newUlid()];
  rows.photos.push(...photoIds);
  const photoKeys = photoIds.map(
    (photoId) => `entries/${ownerId}/${entryId}/${photoId}`,
  );
  await putSamplePhotos(photoKeys);
  await withLocalDb(({ core }) =>
    core.insert(entryPhotos).values(
      photoIds.map((id, position) => ({
        id,
        entryId,
        photoKey: photoKeys[position] ?? "",
        position,
        screenStatus: "pass" as const,
      })),
    ),
  );
  return entryId;
}

test("your own entry under review is marked to you: on the card, on G, on D", async ({
  page,
}) => {
  const rows = seeded();
  const viewerId = await feedUserId();
  try {
    await seedFollowedPost(rows, viewerId);
    // D-67: reports have hidden it pending review. Nobody else can see it
    // now — but its author still does, marked, on the card and on D.
    const ownEntryId = await seedOwnEntry(rows, viewerId, {
      isUnderReview: true,
    });
    await page.goto("/feed");
    await hydrated(page);
    // Round 40 C5b: no gutter between posts — a 1px hairline, and each
    // post keeps SPACE[4] above and below. Read as the browser drew it,
    // so a class Tailwind did not generate fails here.
    const posts = page.locator('[data-part="posts"] > [data-part="post"]');
    await expect(posts.nth(1)).toBeVisible();
    await posts.nth(1).scrollIntoViewIfNeeded();
    // The rule is drawn under every post but the last (`divide-y`).
    const drawn = await posts.first().evaluate((post) => {
      const style = getComputedStyle(post);
      return {
        rule: `${style.borderBottomWidth} ${style.borderBottomStyle}`,
        padding: `${style.paddingTop} ${style.paddingBottom}`,
      };
    });
    expect(drawn).toEqual({ rule: "1px solid", padding: "16px 16px" });
    // Found by its link: the caption that named it is cut (D-167).
    const ownCard = page.locator('[data-part="post"]').filter({
      has: page.locator(`a[href="/feed/entry/${ownEntryId}"]`),
    });
    // Round 29 #4: in the author row, before the badge, in ink — and said
    // aloud as the board's sentence. The card also says YOU, and its photo
    // carries 1 / 2.
    const tag = ownCard.locator(
      '[data-part="author"] [data-part="review-tag"]',
    );
    await expect(tag.locator(':scope > [aria-hidden="true"]')).toHaveText(
      "[Under review]",
      { ignoreCase: true },
    );
    await expect(
      ownCard.locator('a[href^="/feed/entry/"]'),
    ).toHaveAccessibleName(/Under review, other runners can't see this/u);
    await expect(ownCard.getByText(/· You$/u)).toBeVisible();
    await expect(ownCard.getByText("1 / 2")).toBeVisible();

    // G's Recent entries (round 35 #53b): the link names the run's day and
    // distance, and the meta line under it carries the tag first.
    await page.goto("/feed/me");
    await hydrated(page);
    await expect(
      page.getByRole("heading", { name: "Recent entries" }),
    ).toBeVisible();
    const ownRow = page.locator("li").filter({
      has: page.locator(`a[href="/feed/entry/${ownEntryId}"]`),
    });
    // Drawn "Sat, Aug 29 · 8.2 mi", said "Sat, Aug 29, 8.2 miles"
    // (round 52 #158).
    await expect(ownRow.getByRole("link")).toHaveAccessibleName(
      /^[A-Z][a-z]{2}, [A-Z][a-z]{2} \d{1,2}, \d+\.\d (miles|kilometres)$/u,
    );
    await expect(
      ownRow.locator('[data-part="entry-meta"] > :first-child'),
    ).toHaveAttribute("data-part", "review-tag");

    // D · HIDDEN WHILE WE CHECK, at the top.
    await page.goto("/feed");
    await hydrated(page);
    await ownCard.locator('[data-part="run-strip"]').click();
    await hydrated(page);
    const hiddenBand = page.locator('[data-part="notice-band"]');
    await expect(hiddenBand).toContainText(
      "Other runners can't see this while we look at it.",
    );
    await expect(hiddenBand).toContainText("You can still edit or delete it.");
    await expect(page.locator('[data-part="review-tag"]')).toHaveCount(0);
  } finally {
    await removeSeeded(rows);
  }
});

test("your own entry: take back one photo, then the whole entry", async ({
  page,
}) => {
  const rows = seeded();
  const viewerId = await feedUserId();
  try {
    const ownEntryId = await seedOwnEntry(rows, viewerId, {
      isUnderReview: false,
    });
    await page.goto(`/feed/entry/${ownEntryId}`);
    await hydrated(page);
    await page.getByRole("button", { name: "Delete photo 2" }).click();
    await expect(
      page.getByRole("heading", { name: "Delete photo 2?" }),
    ).toBeVisible();
    await page
      .getByRole("button", { name: "Delete photo", exact: true })
      .click();
    await expect(
      page.getByRole("button", { name: "Delete photo 2" }),
    ).toHaveCount(0);
    await expect(
      page.getByRole("button", { name: "Delete photo 1" }),
    ).toBeVisible();

    // …or the whole entry, from the foot under YOURS.
    await page.getByRole("button", { name: "Delete this entry" }).click();
    await expect(
      page.getByRole("heading", { name: "Delete this entry?" }),
    ).toBeVisible();
    await page
      .getByRole("button", { name: "Delete entry", exact: true })
      .click();
    await expect(page).not.toHaveURL(new RegExp(ownEntryId));
    await page.goto(`/feed/entry/${ownEntryId}`);
    await expect(page).not.toHaveURL(new RegExp(ownEntryId));
    // It lands on the feed, whose weather is still being found: the
    // transcript is read when the test ends, so let that settle first.
    await expect(page.locator("[aria-busy='true']")).toHaveCount(0, {
      timeout: 20_000,
    });
  } finally {
    // Only what the deletes above did not reach, if a step failed first.
    await removeSeeded(rows);
  }
});

test("an old handle says the runner moved on; a never-held one, nobody is here", async ({
  page,
}) => {
  const rows = seeded();
  const username = `trail_${String(Date.now()).slice(-8)}`;
  // A handle the same runner used to hold (FEED-10): `/feed/u/old` says
  // they changed their name, and never who they are now (D-56).
  const oldUsername = `was_${String(Date.now()).slice(-8)}`;
  const runnerId = await seedRunner(rows, username);
  try {
    await withLocalDb(({ core }) =>
      core.insert(usernameHistory).values({
        username: oldUsername,
        userId: runnerId,
        retiredAt: nowSeconds(),
      }),
    );
    await page.goto(`/feed/u/${oldUsername}`);
    await hydrated(page);
    await expect(
      page.getByText("This runner changed their name."),
    ).toBeVisible();
    await expect(page.getByText(username)).toHaveCount(0);

    // Round 28 #11: a handle nobody ever held gets the same page a deleted
    // one does, never a redirect, so the two cannot be told apart.
    await page.goto(`/feed/u/never_${String(Date.now()).slice(-8)}`);
    await hydrated(page);
    await expect(page).toHaveURL(/\/feed\/u\/never_/u);
    await expect(page.getByText("This runner isn't here.")).toBeVisible();
  } finally {
    await withLocalDb(({ core }) =>
      core
        .delete(usernameHistory)
        .where(eq(usernameHistory.username, oldUsername)),
    );
    await removeSeeded(rows);
  }
});

test("one bar from 720 up: the tab bar becomes a top bar, and back", async ({
  page,
}) => {
  // The same screen, the same content, two shells (task 115).
  await page.setViewportSize(DESK);
  await page.goto("/feed");
  await hydrated(page);

  const topBar = page.locator('[data-slot="top-bar"]');
  await expect(topBar).toBeVisible();
  // The wordmark is "the one place the logo appears in the product", and
  // it links to Feed.
  await expect(
    topBar.getByRole("link", { name: "dialed.run home" }),
  ).toHaveAttribute("href", "/feed");
  // Four text links in the phone bar's order, plus the pill that says the
  // verb this seat has room for (round 15).
  await expect(bar(page).getByRole("link")).toHaveText([
    "Feed",
    "Closet",
    "Call",
    "You",
  ]);
  await expect(topBar.getByRole("button", { name: "Log a run" })).toBeVisible();
  // One bar at a time: the footer is not merely off-screen, it is not
  // laid out.
  await expect(page.locator('[data-slot="tab-bar"]')).toBeHidden();

  // …and back to the phone, where the footer returns.
  await page.setViewportSize(PHONE);
  await expect(page.locator('[data-slot="tab-bar"]')).toBeVisible();
  await expect(topBar).toBeHidden();
  // The same launcher, in its glyph-sized seat and saying so.
  await expect(launcher(page)).toHaveText("+ Add");
});
