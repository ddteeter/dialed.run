/**
 * Covers: E1 (following feed, the v1 card, its empty state), E2-lite
 * (zero follows lands on Your conditions; the typed city's Find and Use
 * this, round 26 #12), runner search, D (post detail — the strip, the
 * note, the kit), H (someone else's profile), D-11 (useful reactions), the
 * bell counting a run of any age that still owes a verdict (S2), the
 * consensus bars' words as shares of the matched runners (round 35 #54) and
 * the summary sentence under them (round 47 #114), G's settings button,
 * and `@handle` on the author row (FEED-10) — one journey, one video.
 *
 * Exactly one test() per journey spec. A second test here would record a
 * second video beside the one the reviewer is meant to watch; standalone
 * assertions belong in a sibling *.spec.ts — `feed.spec.ts` holds the
 * unconfirmed runner, the under-review entry, taking an entry back, the
 * old and never-held handles, and the shell at both widths.
 *
 * Also demonstrates the privacy law (CLAUDE.md "Product rules"): a private
 * entry seeded for the followed runner must never surface in the follower's
 * feed or on the runner's own public profile.
 */
import { eq } from "drizzle-orm";

import { runs } from "../../src/db/schema-core";
import { newUlid } from "../../src/lib/ids";
import { nowSeconds } from "../../src/lib/now";
import { storageStateFor } from "../support/accounts";
import { bar } from "../support/bars";
import { expect, hydrated, scene, test } from "../support/demo";
import { withLocalDb } from "../support/local-db";
import {
  answerFind,
  feedUserId,
  forgetPlace,
  removeSeeded,
  seedEntry,
  seedObservation,
  seedRunner,
  seeded,
} from "../conformance/feed-support";
import {
  RUNNER_PLACE,
  removeFollowedRunner,
  seedFollowedRunner,
} from "./followed-runner";

// Signed in already: the account is created by the `demo-setup` project, so
// this video opens on the feed rather than on a signup form.
test.use({ storageState: storageStateFor("feed") });

test("follow a runner, browse their feed, open a verdict, and mark it useful", async ({
  page,
}, testInfo) => {
  // ~40 paced actions at the demo project's slowMo outrun Playwright's 30s
  // default, and a timeout kills the cleanup in `finally` with it. Same
  // bump as the onboarding and closet demos.
  testInfo.setTimeout(150_000);
  const suffix = String(Date.now());
  const oldRunId = newUlid();

  // A second runner with one public entry (verdict + conditions + kit) and
  // one private entry.
  const runner = await seedFollowedRunner();
  const { username: otherUsername, publicCaption, privateCaption } = runner;

  // A run of the viewer's own from a month ago that never got a verdict:
  // the bell counts it, at any age (FEED-3).
  const viewerId = await feedUserId();
  await forgetPlace(viewerId);
  await withLocalDb(({ core }) =>
    core.insert(runs).values({
      id: oldRunId,
      userId: viewerId,
      source: "manual",
      startedAt: nowSeconds() - 30 * 24 * 3600,
      durationS: 1800,
      distanceM: 5000,
      indoor: false,
      title: "A run from last month",
      weatherStatus: "none",
    }),
  );

  // Round 35 #54: five runners who logged Portland's conditions this hour
  // somewhere else in the last three days. Every one wore a top and three
  // wore bottoms too, so Tops is All beside another bar and Bottoms is
  // Most at 3 of 5, where round 27's ranking said Most and Some. A
  // feels-like no other demo seeds keeps the count to these five.
  const consensus = seeded();
  const consensusFeelsC = 47;
  const now = nowSeconds();
  await seedObservation(consensus, RUNNER_PLACE, now, {
    feelsLikeC: consensusFeelsC,
  });
  for (let index = 0; index < 5; index += 1) {
    const sharer = await seedRunner(
      consensus,
      `share_${suffix.slice(-6)}_${String(index)}`,
    );
    const place = { lat: (3001 + index) / 100, lng: 70.01 };
    const ranAt = now - (2 + index) * 3600;
    await seedEntry(consensus, {
      userId: sharer,
      place,
      startedAt: ranAt,
      feelsLikeC: consensusFeelsC,
      verdict: 0,
    });
    if (index < 3) {
      await seedEntry(consensus, {
        userId: sharer,
        place: { lat: place.lat, lng: 70.02 },
        startedAt: ranAt - 3600,
        feelsLikeC: consensusFeelsC,
        verdict: 0,
        category: "bottom",
      });
    }
  }

  try {
    // A runner who follows nobody lands on Your conditions (round 22):
    // the one social surface that works on day one. Nothing here grants
    // the browser's location, so the tab asks for a city instead — and
    // never sends the runner to their settings to find it.
    await scene(page, "E2-lite · zero follows lands on Your conditions");
    await page.goto("/feed");
    await hydrated(page);
    await expect(
      page.getByRole("button", { name: "Your conditions" }),
    ).toHaveAttribute("aria-pressed", "true");
    await expect(page.getByText("Where do you run?")).toBeVisible();

    // The bell's number is every run still owed a verdict, however old —
    // a month-old run counts (FEED-3), and the name says it in digits.
    await scene(page, "The bell counts a month-old run still owed a verdict");
    await expect(
      page
        .getByRole("link", { name: /^Notifications, (\d+|more than 9) new$/u })
        .first(),
    ).toBeVisible();

    // Round 26 #12: the typed city is found before it is used. Find shows
    // the one place the provider found; nothing is saved until Use this.
    await scene(page, "Type a city, Find, then Use this");
    await answerFind(page, {
      kind: "found",
      address: "Portland, OR, United States",
      lat: 45.52,
      lng: -122.68,
    });
    await page.getByLabel("Your city").fill("Portland");
    await page.getByRole("button", { name: "Find" }).click();
    await expect(page.getByText("Not it? Add more to the name.")).toBeVisible();
    await page.getByRole("button", { name: "Use this" }).click();
    await expect(page.locator('[data-part="resolved-place"]')).toHaveText(
      "Weather for Portland, OR, United States",
      { ignoreCase: true },
    );
    await page.unrouteAll({ behavior: "ignoreErrors" });

    // Round 35 #54: each bar's word is its share of the matched runners,
    // not its rank. Every runner wore a top, so Tops reads All beside
    // another bar; 3 of 5 is more than half, so Bottoms reads Most.
    await scene(page, "What they wore: All beside Most, each a share");
    const bars = page.locator('[data-part="match-block"] + div li');
    // What is drawn, then what is said: each share is drawn "5/5" and said
    // "5 of 5 runners" in an sr-only span, which `textContent` would join
    // to the drawn text.
    await expect(bars.locator(".sr-only")).toHaveText([
      "5 of 5 runners",
      "3 of 5 runners",
    ]);
    const drawnBars = await bars.evaluateAll((items) =>
      items.map((item) => {
        const copy = item.cloneNode(true);
        if (!(copy instanceof HTMLElement)) return "";
        for (const said of copy.querySelectorAll(".sr-only")) said.remove();
        return copy.textContent;
      }),
    );
    expect(drawnBars).toStrictEqual(["TopsAll5/5", "BottomsMost3/5"]);
    // Round 47 #114: under the bars, what the runners who got it right
    // wore, in the same share words over them. All five called it dialed.
    await scene(page, "E2-lite · the summary sentence, under the bars");
    await expect(page.locator('[data-part="summary"]')).toHaveText(
      "All got it right in tops. Most added bottoms.",
    );

    // Following is a tab away, and its empty state is drawn (E1).
    await scene(page, "E1 · nobody yet, and one way to find someone");
    await page.getByRole("button", { name: "Following" }).click();
    await expect(
      page.getByText("Nobody you follow has posted yet."),
    ).toBeVisible();
    await expect(
      page.getByText("Follow runners you already know by their username."),
    ).toBeVisible();

    // Find the other runner — a row with a Follow pill inline — and open
    // their profile (H).
    await page.getByRole("link", { name: "Find a runner" }).click();
    await scene(page, "Search · name and a Follow pill, no city");
    await page.getByPlaceholder("Search by name").fill(otherUsername);
    const row = page.getByRole("listitem").filter({ hasText: otherUsername });
    await expect(row.getByRole("button", { name: "Follow" })).toBeVisible();
    await row.getByRole("link", { name: otherUsername }).click();

    await scene(page, "H · only their public entries");
    await expect(page.getByText("Portland, OR")).toBeVisible();
    // Not for search engines until the owner decides (FEED-1).
    await expect(page.locator('meta[name="robots"]')).toHaveAttribute(
      "content",
      "noindex",
    );
    await expect(page.getByText(publicCaption)).toBeVisible();
    // Their private entry never appears here either — the profile query
    // only ever selects shared (`runners`) entries.
    await expect(page.getByText(privateCaption)).toHaveCount(0);

    // Follow them: the label waits for the server, then flips.
    await scene(page, "Following is what puts them in the feed");
    await page.getByRole("button", { name: "Follow" }).click();
    await expect(page.getByRole("button", { name: "Following" })).toBeVisible();

    // Back to the feed — now it opens on Following, and their public
    // entry is a v1 card: author and badge, caption, strip, Useful.
    await scene(page, "E1 · the v1 card: author and badge, caption, strip");
    await bar(page).getByRole("link", { name: "Feed" }).click();
    await hydrated(page);
    await expect(
      page.getByRole("button", { name: "Following" }),
    ).toHaveAttribute("aria-pressed", "true");
    const card = page.locator('[data-part="post"]').filter({
      hasText: publicCaption,
    });
    await expect(card).toBeVisible();
    // FEED-9: the compact line tops Following — the Portland runners above
    // matched at the city this runner just saved, in round 25's words.
    const compact = page.locator('[data-part="compact-conditions"]');
    await expect(compact).toContainText("runners logged");
    await expect(compact).toContainText("in the last 3 days.");
    // Its band is Visual Crossing's data, credited right under it (D-144).
    await expect(
      compact.locator("xpath=following-sibling::*[1]"),
    ).toHaveAccessibleName("Weather data provided by Visual Crossing");
    // The author is their handle, "@" and all (FEED-10).
    await expect(card.locator('[data-part="author"]')).toContainText(
      `@${otherUsername}`,
    );
    await expect(card.locator('[data-part="verdict-badge"]')).toHaveText(
      "Dialed",
    );
    // The strip: distance, then the range the run covered and the
    // weather it started in. 6C -> 43F and 14C -> 57F (R-5).
    await expect(card.locator('[data-part="run-strip"]')).toContainText(
      "43–57° · light rain",
    );
    // Visual Crossing's reading, credited beside it (FEED-8): drawn, as the
    // licence asks, but unheard, because the compact line above already
    // said it once for the feed (R-179).
    const cardCredit = card.locator(
      "a[href='https://www.visualcrossing.com/']",
    );
    await expect(cardCredit).toBeVisible();
    await expect(cardCredit).toHaveAttribute("aria-hidden", "true");
    // ...their private entry never does (CLAUDE.md: private entries never
    // appear in feeds or consensus aggregates).
    await expect(page.getByText(privateCaption)).toHaveCount(0);

    // Open the entry detail (D): the strip with its badge, the note, the
    // kit as a list.
    await scene(page, "D · the strip, the note, the kit, then Useful");
    await card.getByText(publicCaption).click();
    await hydrated(page);
    await expect(
      page.getByRole("heading", { name: `@${otherUsername}` }),
    ).toBeVisible();
    await expect(
      page.locator('[data-part="run-strip"] [data-part="verdict-badge"]'),
    ).toHaveText("Dialed");
    await expect(page.getByText("43–57° · light rain")).toBeVisible();
    await expect(
      page.locator('[data-part="run-strip"]').getByRole("link", {
        name: "Weather data provided by Visual Crossing",
      }),
    ).toBeVisible();
    await expect(page.locator('meta[name="robots"]')).toHaveAttribute(
      "content",
      "noindex",
    );
    await expect(page.getByText("Janji Rover Half-Zip")).toBeVisible();

    // Mark it useful — the reaction verb is "useful", never "like" — and
    // the count moves only once the server has said so.
    await scene(page, "Useful, never liked — and never optimistic");
    const useful = page.getByRole("button", { name: /Useful/u });
    await expect(useful).toHaveAttribute("aria-pressed", "false");
    await useful.click();
    await expect(useful).toHaveAttribute("aria-pressed", "true");
    await expect(useful).toContainText("1");

    // G: the settings icon button at the right of the identity line, in
    // every state (round 26 #18).
    await scene(page, "G · Settings is an icon button on the identity line");
    await bar(page).getByRole("link", { name: "You" }).click();
    await hydrated(page);
    await expect(
      page.locator('[data-part="settings-button"]'),
    ).toHaveAccessibleName("Settings");
  } finally {
    await forgetPlace(viewerId);
    await removeSeeded(consensus);
    await withLocalDb(({ core }) =>
      core.delete(runs).where(eq(runs.id, oldRunId)),
    );
    await removeFollowedRunner(runner);
  }
});
