/**
 * Covers: E1 (following feed), D (post detail — verdict, conditions,
 * per-item kit), H (someone else's profile), A3 (the verdict display),
 * D-11 (useful reactions) — one journey, one video.
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
import { expect, scene, test } from "../support/demo";

// Signed in already: the account is created by the `demo-setup` project, so
// this video opens on the feed rather than on a signup form.
test.use({ storageState: storageStateFor("feed") });
import { withLocalDb } from "../support/local-db";

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
  const startedAt = Math.floor(Date.now() / 1000) - 3 * 3600;
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
    await scene(page, "E1 · a feed with nobody followed yet");
    await page.goto("/feed");
    await hydrated(page);

    // Browse the feed (E1) with zero follows — the documented empty state.
    await expect(
      page.getByText("Nobody you follow has posted yet."),
    ).toBeVisible();

    // Find the other runner and open their profile (H).
    await page
      .getByRole("link", { name: "Search for runners to follow" })
      .click();
    await scene(page, "Find a runner, and see only their public entries");
    await page.getByPlaceholder("Search by name").fill(otherDisplayName);
    await page.getByRole("link", { name: otherDisplayName }).click();
    await expect(page.getByText("Portland, OR")).toBeVisible();
    await expect(page.getByText(publicCaption)).toBeVisible();
    // Their private entry never appears here either — the profile query
    // only ever selects isPublic entries.
    await expect(page.getByText(privateCaption)).toHaveCount(0);

    // Follow them.
    await scene(page, "Following is what puts them in the feed");
    await page.getByRole("button", { name: "Follow" }).click();
    await expect(page.getByRole("button", { name: "Following" })).toBeVisible();

    // Back to the feed — their public entry now shows up...
    await page.getByRole("link", { name: "Feed" }).click();
    await expect(page.getByText(publicCaption)).toBeVisible();
    // ...their private entry never does (CLAUDE.md: private entries never
    // appear in feeds or consensus aggregates).
    await expect(page.getByText(privateCaption)).toHaveCount(0);

    // Open the entry detail (D): verdict, conditions, per-item kit.
    await scene(page, "D · the verdict, the conditions, and the kit");
    await page.getByText(publicCaption).click();
    await expect(page.getByText("[Dialed]")).toBeVisible();
    // The range the run actually covered, not the hour it started in.
    // 6C -> 43F and 14C -> 57F (D-5).
    await expect(page.getByText("43–57°")).toBeVisible();
    await expect(page.getByText("light rain")).toBeVisible();
    await expect(page.getByText("Rover Half-Zip")).toBeVisible();

    // Mark it useful — the reaction verb is "useful", never "like".
    await scene(page, "Useful, never liked — the lexicon is a code rule");
    await page.getByRole("button", { name: /^Useful/u }).click();
    await expect(
      page.getByRole("button", { name: "Useful [1]" }),
    ).toBeVisible();
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
