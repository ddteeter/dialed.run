/**
 * Covers: E1 (following feed, the v1 card, its empty state), E2-lite
 * (zero follows lands on Your conditions), runner search, D (post detail —
 * the strip, the note, the kit), H (someone else's profile), D-11 (useful
 * reactions) — one journey, one video.
 *
 * Exactly one test() per demo spec. A second test here would record a
 * second video beside the one the reviewer is meant to watch; standalone
 * assertions belong in a sibling *.spec.ts.
 *
 * Also demonstrates the privacy law (CLAUDE.md "Product rules"): a private
 * entry seeded for the followed runner must never surface in the follower's
 * feed or on the runner's own public profile.
 */
import { eq, inArray } from "drizzle-orm";

import {
  entryTags as entryTagsTable,
  outfitEntries,
  outfitEntryItems,
  runs,
  userProfiles,
  wardrobeItems,
} from "../../src/db/schema-core";
import { weatherObservations } from "../../src/db/schema-weather";
import { newUlid } from "../../src/lib/ids";
import { storageStateFor } from "../support/accounts";
import { DESK, PHONE, bar, launcher } from "../support/bars";
import { expect, scene, test } from "../support/demo";

// Signed in already: the account is created by the `demo-setup` project, so
// this video opens on the feed rather than on a signup form.
test.use({ storageState: storageStateFor("feed") });
import { withLocalDb } from "../support/local-db";
import { nowSeconds } from "../../src/lib/now";

/** Layout stamps html[data-hydrated] once React attaches; driving
 *  controlled inputs before that races hydration's state reset. */
async function hydrated(page: import("@playwright/test").Page): Promise<void> {
  await page
    .locator('html[data-hydrated="true"]')
    .waitFor({ state: "attached" });
}

test("follow a runner, browse their feed, open a verdict, and mark it useful", async ({
  page,
}) => {
  const suffix = String(Date.now());
  const otherUserId = newUlid();
  const otherDisplayName = `Demo Trailrunner ${suffix}`;
  const itemId = newUlid();
  const publicRunId = newUlid();
  const publicEntryId = newUlid();
  const privateRunId = newUlid();
  const privateEntryId = newUlid();
  const observationId = newUlid();
  const midObservationId = newUlid();
  const endObservationId = newUlid();

  // Three hours back, so a two-hour run is entirely in the past.
  const startedAt = nowSeconds() - 3 * 3600;
  const latR = 45.52;
  const lngR = -122.68;
  const hourBucket = Math.floor(startedAt / 3600);

  const publicCaption = `Chilly first mile, settled in by the bridge — ${suffix}`;
  const privateCaption = `Private entry that must never leak — ${suffix}`;

  // Seed a second runner with one public entry (verdict + conditions +
  // kit) and one private entry, scoped entirely to ids generated above —
  // never a bare delete of these tables.
  await withLocalDb(async ({ core, weather }) => {
    await core.insert(userProfiles).values({
      userId: otherUserId,
      displayName: otherDisplayName,
      cityLabel: "Portland, OR",
    });

    await core.insert(wardrobeItems).values({
      id: itemId,
      userId: otherUserId,
      category: "top",
      layer: "mid",
      brand: "Janji",
      name: "Rover Half-Zip",
      origin: "manual",
      createdAt: startedAt,
    });

    await core.insert(runs).values([
      {
        id: publicRunId,
        userId: otherUserId,
        source: "manual",
        startedAt,
        // Two hours, so the run spans three hour buckets and the feed can
        // show what it actually covered rather than the hour it began in
        // (D-5). The caption is already written for a run that warms up.
        durationS: 2 * 3600,
        distanceM: 6437,
        lat: latR,
        lng: lngR,
        indoor: false,
        title: "Morning loop",
        weatherStatus: "attached",
      },
      {
        id: privateRunId,
        userId: otherUserId,
        source: "manual",
        startedAt,
        durationS: 1500,
        distanceM: 5000,
        lat: latR,
        lng: lngR,
        indoor: false,
        title: "Private shakeout",
        weatherStatus: "attached",
      },
    ]);

    await core.insert(outfitEntries).values([
      {
        id: publicEntryId,
        runId: publicRunId,
        userId: otherUserId,
        verdict: 0,
        isPublic: true,
        caption: publicCaption,
        createdAt: startedAt,
      },
      {
        id: privateEntryId,
        runId: privateRunId,
        userId: otherUserId,
        verdict: -1,
        isPublic: false,
        caption: privateCaption,
        createdAt: startedAt,
      },
    ]);

    await core
      .insert(outfitEntryItems)
      .values({ entryId: publicEntryId, itemId });
    await core
      .insert(entryTagsTable)
      .values({ entryId: publicEntryId, tag: "cold_first_mile" });

    // Weather is seeded, never stubbed: this cache-key row makes the feed
    // module hit cache and never call Visual Crossing, with the real code
    // path still running.
    // One row per hour the run spans — which is what `attach.ts` resolves
    // for a real run, and what the feed now reads back. Warming 6 -> 14
    // across the two hours: a chilly first mile that settles in.
    //
    // Only the starting hour carries `runId`; the others are shared cache
    // cells, exactly as the attach path writes them.
    await weather.insert(weatherObservations).values([
      {
        id: observationId,
        runId: publicRunId,
        latR,
        lngR,
        hourBucket,
        tempC: 6,
        feelsLikeC: 4,
        humidity: 70,
        windKph: 12,
        precipMm: 0.4,
        condition: "light rain",
        source: "visualcrossing",
        fetchedAt: startedAt,
      },
      {
        id: midObservationId,
        latR,
        lngR,
        hourBucket: hourBucket + 1,
        tempC: 10,
        feelsLikeC: 9,
        humidity: 65,
        windKph: 10,
        precipMm: 0,
        condition: "cloudy",
        source: "visualcrossing",
        fetchedAt: startedAt,
      },
      {
        id: endObservationId,
        latR,
        lngR,
        hourBucket: hourBucket + 2,
        tempC: 14,
        feelsLikeC: 13,
        humidity: 55,
        windKph: 8,
        precipMm: 0,
        condition: "clear",
        source: "visualcrossing",
        fetchedAt: startedAt,
      },
    ]);
  });

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
    ).toHaveAttribute("aria-current", "page");
    await expect(page.getByText("Where do you run?")).toBeVisible();

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
    await page.getByPlaceholder("Search by name").fill(otherDisplayName);
    const row = page
      .getByRole("listitem")
      .filter({ hasText: otherDisplayName });
    await expect(row.getByRole("button", { name: "Follow" })).toBeVisible();
    await row.getByRole("link", { name: otherDisplayName }).click();

    await scene(page, "H · only their public entries");
    await expect(page.getByText("Portland, OR")).toBeVisible();
    await expect(page.getByText(publicCaption)).toBeVisible();
    // Their private entry never appears here either — the profile query
    // only ever selects isPublic entries.
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
    ).toHaveAttribute("aria-current", "page");
    const card = page.locator('[data-part="post"]').filter({
      hasText: publicCaption,
    });
    await expect(card).toBeVisible();
    await expect(card.locator('[data-part="verdict-badge"]')).toHaveText(
      "Dialed",
    );
    // The strip: distance, then the range the run covered and the
    // weather it started in. 6C -> 43F and 14C -> 57F (D-5).
    await expect(card.locator('[data-part="run-strip"]')).toContainText(
      "43–57° · light rain",
    );
    // ...their private entry never does (CLAUDE.md: private entries never
    // appear in feeds or consensus aggregates).
    await expect(page.getByText(privateCaption)).toHaveCount(0);

    // Open the entry detail (D): the strip with its badge, the note, the
    // kit as a list.
    await scene(page, "D · the strip, the note, the kit, then Useful");
    await card.getByText(publicCaption).click();
    await hydrated(page);
    await expect(
      page.getByRole("heading", { name: otherDisplayName }),
    ).toBeVisible();
    await expect(
      page.locator('[data-part="run-strip"] [data-part="verdict-badge"]'),
    ).toHaveText("Dialed");
    await expect(page.getByText("43–57° · light rain")).toBeVisible();
    await expect(page.getByText("Janji Rover Half-Zip")).toBeVisible();

    // Mark it useful — the reaction verb is "useful", never "like" — and
    // the count moves only once the server has said so.
    await scene(page, "Useful, never liked — and never optimistic");
    const useful = page.getByRole("button", { name: /Useful/u });
    await expect(useful).toHaveAttribute("aria-pressed", "false");
    await useful.click();
    await expect(useful).toHaveAttribute("aria-pressed", "true");
    await expect(useful).toContainText("1");

    // ---- The shell, at both widths (task 115) --------------------------
    //
    // The demo canvas has been 1280x720 since the project was written,
    // which until now meant recording a phone-width app on a desktop
    // screen. This is the beat where that stops being true, and it is the
    // one a reviewer should watch: same screen, same content, two shells.
    await scene(page, "One bar from 720 up — the tab bar becomes a top bar");
    await bar(page).getByRole("link", { name: "Feed" }).click();
    await hydrated(page);

    const topBar = page.locator('[data-slot="top-bar"]');
    await expect(topBar).toBeVisible();
    // The wordmark is "the one place the logo appears in the product", and
    // it links to Feed.
    await expect(
      topBar.getByRole("link", { name: "dialed.run home" }),
    ).toHaveAttribute("href", "/feed");
    // Four text links in the phone bar's order, plus the pill that says
    // the verb this seat has room for (round 15).
    await expect(bar(page).getByRole("link")).toHaveText([
      "Feed",
      "Closet",
      "Call",
      "You",
    ]);
    await expect(
      topBar.getByRole("button", { name: "Log a run" }),
    ).toBeVisible();
    // One bar at a time: the footer is not merely off-screen, it is not
    // laid out.
    await expect(page.locator('[data-slot="tab-bar"]')).toBeHidden();

    await scene(page, "…and back to the phone, where the footer returns");
    await page.setViewportSize(PHONE);
    await expect(page.locator('[data-slot="tab-bar"]')).toBeVisible();
    await expect(topBar).toBeHidden();
    // The same launcher, in its glyph-sized seat and saying so.
    await expect(launcher(page)).toHaveText("+ Add");
    await page.setViewportSize(DESK);
  } finally {
    await withLocalDb(async ({ core, weather }) => {
      await core
        .delete(outfitEntryItems)
        .where(eq(outfitEntryItems.entryId, publicEntryId));
      await core
        .delete(entryTagsTable)
        .where(eq(entryTagsTable.entryId, publicEntryId));
      await core
        .delete(outfitEntries)
        .where(eq(outfitEntries.id, publicEntryId));
      await core
        .delete(outfitEntries)
        .where(eq(outfitEntries.id, privateEntryId));
      await core.delete(runs).where(eq(runs.id, publicRunId));
      await core.delete(runs).where(eq(runs.id, privateRunId));
      await core.delete(wardrobeItems).where(eq(wardrobeItems.id, itemId));
      await core
        .delete(userProfiles)
        .where(eq(userProfiles.userId, otherUserId));
      await weather
        .delete(weatherObservations)
        .where(
          inArray(weatherObservations.id, [
            observationId,
            midObservationId,
            endObservationId,
          ]),
        );
    });
  }
});
