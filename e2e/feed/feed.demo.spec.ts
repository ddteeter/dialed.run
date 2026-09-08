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
import { eq } from "drizzle-orm";

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
import { expect, test } from "../support/demo";
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

  const startedAt = Math.floor(Date.now() / 1000) - 3600;
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
        durationS: 1800,
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
    await weather.insert(weatherObservations).values({
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
    });
  });

  try {
    const demoEmail = `demo-${suffix}@example.com`;
    await page.goto("/auth/signup");
    await hydrated(page);
    await page.getByLabel("Name").fill("Demo Runner");
    await page.getByLabel("Email").fill(demoEmail);
    await page.getByLabel("Password").fill("a-long-enough-password");
    await page.getByRole("button", { name: "Sign up" }).click();
    await expect(page.getByText(demoEmail)).toBeVisible({ timeout: 15_000 });

    // Browse the feed (E1) with zero follows — the documented empty state.
    await page.getByRole("link", { name: "Feed" }).click();
    await expect(
      page.getByText("Nobody you follow has posted yet."),
    ).toBeVisible();

    // Find the other runner and open their profile (H).
    await page
      .getByRole("link", { name: "Search for runners to follow" })
      .click();
    await page.getByPlaceholder("Search by name").fill(otherDisplayName);
    await page.getByRole("link", { name: otherDisplayName }).click();
    await expect(page.getByText("Portland, OR")).toBeVisible();
    await expect(page.getByText(publicCaption)).toBeVisible();
    // Their private entry never appears here either — the profile query
    // only ever selects isPublic entries.
    await expect(page.getByText(privateCaption)).toHaveCount(0);

    // Follow them.
    await page.getByRole("button", { name: "Follow" }).click();
    await expect(page.getByRole("button", { name: "Following" })).toBeVisible();

    // Back to the feed — their public entry now shows up...
    await page.getByRole("link", { name: "Feed" }).click();
    await expect(page.getByText(publicCaption)).toBeVisible();
    // ...their private entry never does (CLAUDE.md: private entries never
    // appear in feeds or consensus aggregates).
    await expect(page.getByText(privateCaption)).toHaveCount(0);

    // Open the entry detail (D): verdict, conditions, per-item kit.
    await page.getByText(publicCaption).click();
    await expect(page.getByText("[Dialed]")).toBeVisible();
    await expect(page.getByText("43°")).toBeVisible();
    await expect(page.getByText("light rain")).toBeVisible();
    await expect(page.getByText("Rover Half-Zip")).toBeVisible();

    // Mark it useful — the reaction verb is "useful", never "like".
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
      await core.delete(outfitEntries).where(eq(outfitEntries.id, publicEntryId));
      await core.delete(outfitEntries).where(eq(outfitEntries.id, privateEntryId));
      await core.delete(runs).where(eq(runs.id, publicRunId));
      await core.delete(runs).where(eq(runs.id, privateRunId));
      await core.delete(wardrobeItems).where(eq(wardrobeItems.id, itemId));
      await core.delete(userProfiles).where(eq(userProfiles.userId, otherUserId));
      await weather
        .delete(weatherObservations)
        .where(eq(weatherObservations.id, observationId));
    });
  }
});
