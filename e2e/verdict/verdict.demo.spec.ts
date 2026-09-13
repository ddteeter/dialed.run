/**
 * Covers: A3 (log the verdict) — choosing a verdict, flagging a kit item,
 * and attaching a photo, seeing it on the entry, and re-opening the
 * verdict to find all three still there. One journey, one video.
 *
 * Why this exists separately from feed.demo.spec.ts: that one is the
 * *reader's* journey (follow, browse, open, mark useful) and its Covers
 * header claims A3 only as a display. Nothing demonstrated the writer's
 * half, which is where the photo upload lives.
 *
 * The upload is the point. It moved from base64-over-JSON to multipart
 * FormData, and the only honest way to know that works is to watch a real
 * file go up and come back as a rendered image.
 */
import { eq } from "drizzle-orm";

import {
  outfitEntries,
  outfitEntryItems,
  runs,
  wardrobeItems,
} from "../../src/db/schema-core";
import { user } from "../../src/db/schema-auth";
import { weatherObservations } from "../../src/db/schema-weather";
import { newUlid } from "../../src/lib/ids";
import { accountEmail, storageStateFor } from "../support/accounts";
import { expect, scene, test } from "../support/demo";

// Signed in already: the account is created by the `demo-setup` project, so
// this video opens on the verdict screen rather than on a signup form.
test.use({ storageState: storageStateFor("verdict") });
import { withLocalDb } from "../support/local-db";

/** Layout stamps html[data-hydrated] once React attaches; driving
 *  controlled inputs before that races hydration's state reset. */
async function hydrated(page: import("@playwright/test").Page): Promise<void> {
  await page
    .locator('html[data-hydrated="true"]')
    .waitFor({ state: "attached" });
}

/**
 * A real 1x1 PNG. Small enough to keep the recording quick, and a genuine
 * decodable image rather than random bytes with an image/png label — the
 * upload path stores what it is given, so a fake would still "work" and
 * would prove less.
 */
const PNG_1X1 = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
  "base64",
);

test("log a verdict on your own run: pick it, flag an item, attach a photo", async ({
  page,
}, testInfo) => {
  // Paced runs (npm run demo) need headroom; at full speed this is quick.
  testInfo.setTimeout(150_000);

  // The address the setup signed this account up with. The seeding below
  // has to own its rows — the verdict screen is owner-only.
  const email = accountEmail("verdict");
  const itemId = newUlid();
  const runId = newUlid();
  const entryId = newUlid();
  const observationId = newUlid();

  // Coordinates distinct from feed.demo's. Observations are cached by
  // rounded lat/lng/hour, so sharing them would mean one spec's seed
  // silently satisfying another's lookup — which is exactly the coupling
  // that made the first version of this spec pass alone and fail in a full
  // run.
  const latR = 40.71;
  const lngR = -74.01;

  // Seed a run and an un-verdicted entry owned by the account that just
  // signed up — the verdict screen is owner-only, so the rows have to
  // belong to this user rather than a fixture one.
  const startedAt = Math.floor(Date.now() / 1000) - 3600;
  await withLocalDb(async ({ core }) => {
    const [row] = await core
      .select({ id: user.id })
      .from(user)
      .where(eq(user.email, email))
      .limit(1);
    if (!row) throw new Error("signup did not create a user row");

    await core.insert(wardrobeItems).values({
      id: itemId,
      userId: row.id,
      name: "Houdini Jacket",
      brand: "Patagonia",
      category: "top",
      layer: "outer",
      createdAt: startedAt,
    });
    await core.insert(runs).values({
      id: runId,
      userId: row.id,
      title: "Riverside loop",
      startedAt,
      durationS: 2700,
      distanceM: 8000,
      source: "manual",
      indoor: false,
      weatherStatus: "attached",
      lat: latR,
      lng: lngR,
    });
    await core.insert(outfitEntries).values({
      id: entryId,
      userId: row.id,
      runId,
      isPublic: true,
      createdAt: startedAt,
    });
    await core.insert(outfitEntryItems).values({ entryId, itemId });
  });

  // Seed the conditions this entry was logged in. Without an observation
  // the screen has no temperature band, and saving takes a different
  // branch — so this is seeded deliberately rather than left to chance.
  await withLocalDb(async ({ weather }) => {
    await weather
      .insert(weatherObservations)
      .values({
        id: observationId,
        runId,
        latR,
        lngR,
        hourBucket: Math.floor(startedAt / 3600),
        tempC: 6,
        feelsLikeC: 4,
        humidity: 70,
        windKph: 12,
        precipMm: 0,
        condition: "clear",
        source: "visualcrossing",
        fetchedAt: startedAt,
      })
      // (lat_r, lng_r, hour_bucket) is the cache key and is UNIQUE, so a
      // re-run inside the same hour hits the row the last run left. Upsert
      // rather than insert: the spec has to be re-runnable, and the values
      // below are the ones its assertions depend on.
      .onConflictDoUpdate({
        target: [
          weatherObservations.latR,
          weatherObservations.lngR,
          weatherObservations.hourBucket,
        ],
        set: { runId, tempC: 6, feelsLikeC: 4, source: "visualcrossing" },
      });
  });

  await page.goto(`/feed/verdict/${entryId}`);
  await hydrated(page);

  // A3: the five-point scale, coldest to warmest, from the one shared
  // verdictScale rather than a per-screen copy.
  await scene(page, "A3 · five points, coldest to warmest, one scale");
  await page.getByRole("button", { name: "A bit cold" }).click();

  // Per-item signal is a flag, never a second verdict (CLAUDE.md).
  await scene(page, "Per-item signal is a flag, never a second verdict");
  await page.getByRole("combobox").first().selectOption("not_enough");

  // The upload under test: a real file, streamed as multipart.
  await scene(page, "A real photo, streamed as multipart and stored in R2");
  await page.setInputFiles('input[type="file"]', {
    name: "kit.png",
    mimeType: "image/png",
    buffer: PNG_1X1,
  });

  // It came back as a stored key and renders through the owner-scoped
  // photo route — proof the round trip worked, not just that the POST
  // returned.
  await expect(page.locator('img[src^="/feed/photo/"]')).toBeVisible({
    timeout: 15_000,
  });

  await scene(page, "Saving reports the wear rate in this temperature band");
  await page.getByRole("button", { name: "Save verdict" }).click();

  // With conditions resolved, saving reports the item's wear rate in this
  // temperature band rather than navigating away — the calibration signal
  // that makes a verdict worth logging.
  await expect(page.getByText(/Houdini Jacket is now \d+ of \d+/)).toBeVisible({
    timeout: 15_000,
  });

  // And the verdict is on the entry.
  await scene(page, "And the verdict is on the entry");
  await page.goto(`/feed/entry/${entryId}`);
  await expect(page.getByText("[A bit cold]")).toBeVisible({ timeout: 15_000 });

  // Re-opening it shows what was saved, which is not what it used to do.
  //
  // The flag pickers were seeded empty rather than from
  // `entry.items[].flag`, so coming back here showed every piece as
  // unflagged — and saving again wrote that emptiness over the flag the
  // runner had set. Nothing said so; the screen just quietly disagreed
  // with the database. The verdict and the photo come back too.
  await page.goto(`/feed/verdict/${entryId}`);
  await hydrated(page);
  await expect(page.getByRole("combobox").first()).toHaveValue("not_enough");
  await expect(page.locator('img[src^="/feed/photo/"]')).toBeVisible({
    timeout: 15_000,
  });
});
