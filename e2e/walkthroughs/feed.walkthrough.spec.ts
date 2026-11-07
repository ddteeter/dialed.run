/**
 * Walkthrough · the feed (design 180, step 5): find a runner by their
 * handle, follow them, see the kit they shared in the feed, open it, and
 * mark it useful. The other runner and their one shared entry are seeded,
 * weather and all; the feed journey (`e2e/feed/`) carries the edge cases.
 */
import { nowSeconds } from "../../src/lib/now";
import {
  removeSeeded,
  seedEntry,
  seedRunner,
  seeded,
} from "../conformance/feed-support";
import { bar } from "../support/bars";
import { hydrated, scene, typeSlowly } from "../support/demo";
import { expect, test } from "../support/walkthrough";

const CAPTION = "Chilly first mile, settled in by the bridge.";

test("the feed: find a runner, follow them, open their kit, mark it useful", async ({
  page,
}, testInfo) => {
  // Recording pace is not a latency budget; this catches a hang.
  testInfo.setTimeout(400_000);

  // A runner to find: confirmed, with one run shared to runners, its
  // kit, its verdict and the hour's reading. A handle of their own per
  // recording, so the desk and phone runs never find each other's.
  const rows = seeded();
  const handle = `trail_${String(Date.now()).slice(-7)}`;
  const other = await seedRunner(rows, handle);
  await seedEntry(rows, {
    userId: other,
    place: { lat: 41.88, lng: -87.63 },
    // Three hours back, and inside one hour: one reading covers it.
    startedAt: (Math.floor(nowSeconds() / 3600) - 3) * 3600 + 60,
    feelsLikeC: 4,
    verdict: 0,
    audience: "runners",
    caption: CAPTION,
    itemName: "Merino half-zip",
  });

  try {
    await page.goto("/feed");
    await hydrated(page);
    await scene(page, "The feed · Following", {
      say: "This is the feed, where runners share what they wore and how it went. I'll switch to Following: the runners I follow.",
    });
    await page.getByRole("button", { name: "Following" }).click();
    await expect(
      page.getByText("Nobody you follow has posted yet."),
    ).toBeVisible();
    await expect(
      page.getByRole("link", { name: "Find a runner" }),
    ).toBeVisible();
    await scene(page, "Following · nobody yet", {
      say: "A new runner follows nobody yet, so it says so, and offers one way in.",
    });

    await scene(page, "Find a runner · search by handle", {
      say: "I'll tap Find a runner, and search for a friend I run with, by their handle.",
    });
    await page.getByRole("link", { name: "Find a runner" }).click();
    await hydrated(page);
    await typeSlowly(page.getByPlaceholder("Search by name"), handle);
    const row = page.getByRole("listitem").filter({ hasText: handle });
    await expect(row.getByRole("button", { name: "Follow" })).toBeVisible();
    await scene(page, "Find a runner · by their handle", {
      say: "There they are. Each result has a Follow button right on it, but first I'll open their profile.",
    });

    await row.getByRole("link", { name: handle }).click();
    await hydrated(page);
    await expect(page.getByText(CAPTION)).toBeVisible();
    await expect(page.getByRole("button", { name: "Follow" })).toBeVisible();
    await scene(page, "Their profile · what they shared", {
      say: "Their profile shows what they've shared: here, one run, with their note about a chilly first mile. I'll follow them.",
    });
    await page.getByRole("button", { name: "Follow" }).click();
    await expect(page.getByRole("button", { name: "Following" })).toBeVisible();
    await scene(page, "Following", {
      say: "The button says Following now. Let's see what that does to the feed.",
    });

    await bar(page).getByRole("link", { name: "Feed" }).click();
    await hydrated(page);
    await expect(
      page.getByRole("button", { name: "Following" }),
    ).toHaveAttribute("aria-pressed", "true");
    const card = page.locator('[data-part="post"]').filter({
      hasText: CAPTION,
    });
    await expect(card.locator('[data-part="author"]')).toContainText(
      `@${handle}`,
    );
    await expect(card.locator('[data-part="verdict-badge"]')).toHaveText(
      "Dialed",
    );
    await expect(card.locator('[data-part="run-strip"]')).toContainText(/\d°/u);
    await card.scrollIntoViewIfNeeded();
    await scene(page, "In your feed · their run and its verdict", {
      say: "Back on the feed, their run is there: who ran it, the conditions, their note, and the Verdict. They called it dialed.",
    });

    await scene(page, "Opening their run", {
      say: "I'll open it to see what they wore.",
    });
    await card.getByText(CAPTION).click();
    await hydrated(page);
    await expect(
      page.getByRole("heading", { name: `@${handle}` }),
    ).toBeVisible();
    const strip = page.locator('[data-part="run-strip"]');
    await expect(strip).toContainText(/\d°/u);
    await expect(strip.locator('[data-part="verdict-badge"]')).toHaveText(
      "Dialed",
    );
    await expect(page.getByText("Merino half-zip")).toBeVisible();
    await scene(page, "Their Kit · beside the conditions and the Verdict", {
      say: "Here's the Kit behind that Verdict: a merino half-zip, shown with the conditions they ran in and their dialed.",
    });

    const useful = page.getByRole("button", { name: /Useful/u });
    await expect(useful).toHaveAttribute("aria-pressed", "false");
    await scene(page, "Was it useful?", {
      say: "That tells me what works on a morning like that, so I'll mark it useful.",
    });
    await useful.click();
    await expect(useful).toHaveAttribute("aria-pressed", "true");
    await expect(useful).toContainText("1");
    await scene(page, "Useful · never liked", {
      say: "Not liked: useful, because the point is knowing what to wear. The count shows one.",
    });
  } finally {
    await removeSeeded(rows);
  }
});
