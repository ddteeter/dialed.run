/**
 * Covers: E1 (following feed, the v1 card, its empty state), E2-lite
 * (zero follows lands on Your conditions; the typed city's Find and Use
 * this, round 26 #12), runner search, D (post detail — the strip, the
 * note, the kit), H (someone else's profile), D-11 (useful reactions), the
 * bell counting a run of any age that still owes a verdict (S2), G's
 * settings button, `@handle` on the author row and `/@old` saying the
 * runner changed their name (FEED-10), the author's own under-review entry
 * marked on the card and on D (FEED-6, D-67), and a runner taking back
 * their own entry — one photo, then the whole entry (task 128 · SAF-3) —
 * one journey, one video.
 *
 * Exactly one test() per demo spec. A second test here would record a
 * second video beside the one the reviewer is meant to watch; standalone
 * assertions belong in a sibling *.spec.ts.
 *
 * Also demonstrates the privacy law (CLAUDE.md "Product rules"): a private
 * entry seeded for the followed runner must never surface in the follower's
 * feed or on the runner's own public profile.
 */
import { readFile } from "node:fs/promises";

import { eq, inArray } from "drizzle-orm";
import { getPlatformProxy } from "wrangler";

import {
  entryPhotos,
  entryTags as entryTagsTable,
  outfitEntries,
  outfitEntryItems,
  runs,
  userProfiles,
  usernameHistory,
  wardrobeItems,
} from "../../src/db/schema-core";
import { weatherObservations } from "../../src/db/schema-weather";
import { newUlid } from "../../src/lib/ids";
import { userIdOf } from "../conformance/logging-fixtures";
import { storageStateFor } from "../support/accounts";
import { DESK, PHONE, bar, launcher } from "../support/bars";
import { expect, hydrated, scene, test } from "../support/demo";

// Signed in already: the account is created by the `demo-setup` project, so
// this video opens on the feed rather than on a signup form.
test.use({ storageState: storageStateFor("feed") });
import { withLocalDb } from "../support/local-db";
import { nowSeconds } from "../../src/lib/now";
import {
  answerFind,
  feedUserId,
  forgetPlace,
} from "../conformance/feed-support";

test("follow a runner, browse their feed, open a verdict, and mark it useful", async ({
  page,
}, testInfo) => {
  // ~40 paced actions at the demo project's slowMo outrun Playwright's 30s
  // default, and a timeout kills the cleanup in `finally` with it. Same
  // bump as the onboarding and closet demos.
  testInfo.setTimeout(150_000);
  const suffix = String(Date.now());
  const otherUserId = newUlid();
  const otherUsername = `trail_${suffix.slice(-8)}`;
  // A handle the same runner used to hold (FEED-10): `/@old` says they
  // changed their name, and never who they are now (D-56).
  const oldUsername = `was_${suffix.slice(-8)}`;
  const itemId = newUlid();
  const publicRunId = newUlid();
  const publicEntryId = newUlid();
  const privateRunId = newUlid();
  const privateEntryId = newUlid();
  const observationId = newUlid();
  const midObservationId = newUlid();
  const endObservationId = newUlid();
  const oldRunId = newUlid();

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
      username: otherUsername,
      cityLabel: "Portland, OR",
    });
    await core.insert(usernameHistory).values({
      username: oldUsername,
      userId: otherUserId,
      retiredAt: nowSeconds(),
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

  const ownRunId = newUlid();
  const ownEntryId = newUlid();
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

    // The bell's number is every run still owed a verdict, however old —
    // a month-old run counts (FEED-3), and the name says it in digits.
    await scene(page, "The bell counts a month-old run still owed a verdict");
    await expect(
      page
        .getByRole("link", { name: /^Notifications, (\d+|9\+) new$/u })
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
    // The author is their handle, "@" and all (FEED-10).
    await expect(card.locator('[data-part="author"]')).toContainText(
      `@${otherUsername}`,
    );
    await expect(card.locator('[data-part="verdict-badge"]')).toHaveText(
      "Dialed",
    );
    // The strip: distance, then the range the run covered and the
    // weather it started in. 6C -> 43F and 14C -> 57F (D-5).
    await expect(card.locator('[data-part="run-strip"]')).toContainText(
      "43–57° · light rain",
    );
    // Visual Crossing's reading, credited beside it (FEED-8).
    await expect(
      card.getByRole("link", { name: "Weather by Visual Crossing" }),
    ).toBeVisible();
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
      page
        .locator('[data-part="run-strip"]')
        .getByRole("link", { name: "Weather by Visual Crossing" }),
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

    // ---- Taking it back (task 128 · SAF-3) ------------------------------
    //
    // Seeded here, not above: an entry of the viewer's own would have put
    // something in the empty feed the first beats show.
    const ownerId = await userIdOf("feed");
    const photoIds = [newUlid(), newUlid()];
    const photoKeys = photoIds.map(
      (photoId) => `entries/${ownerId}/${ownEntryId}/${photoId}`,
    );
    const photo = await readFile("test/fixtures/sample-photo.bin");
    const media = await getPlatformProxy<Env>();
    try {
      for (const key of photoKeys) {
        await media.env.MEDIA.put(key, photo, {
          httpMetadata: { contentType: "image/jpeg" },
        });
      }
    } finally {
      await media.dispose();
    }
    await withLocalDb(async ({ core }) => {
      await core.insert(runs).values({
        id: ownRunId,
        userId: ownerId,
        source: "manual",
        startedAt: nowSeconds() - 7200,
        durationS: 2400,
        distanceM: 8000,
        lat: 45.52,
        lng: -122.68,
        indoor: false,
        title: "Tempo on the river",
      });
      await core.insert(outfitEntries).values({
        id: ownEntryId,
        runId: ownRunId,
        userId: ownerId,
        verdict: 0,
        isPublic: true,
        caption: "Two photos, one too many",
        createdAt: nowSeconds() - 7000,
      });
      await core.insert(entryPhotos).values(
        photoIds.map((id, position) => ({
          id,
          entryId: ownEntryId,
          photoKey: photoKeys[position] ?? "",
          position,
          screenStatus: "pass" as const,
        })),
      );
    });

    // D-67: reports have hidden it pending review. Nobody else can see it
    // now — but its author still does, marked, on the card and on D.
    await withLocalDb(async ({ core }) => {
      await core
        .update(outfitEntries)
        .set({ moderationStatus: "hidden_pending_review" })
        .where(eq(outfitEntries.id, ownEntryId));
    });
    await scene(page, "Under review: still yours to see, and marked");
    await page.goto("/feed");
    await hydrated(page);
    const ownCard = page.locator('[data-part="post"]').filter({
      hasText: "Two photos, one too many",
    });
    await expect(ownCard.locator('[data-part="under-review"]')).toHaveText(
      "[Under review]",
      { ignoreCase: true },
    );
    await ownCard.getByText("Two photos, one too many").click();
    await hydrated(page);
    await expect(page.locator('[data-part="under-review"]')).toHaveText(
      "[Under review]",
      { ignoreCase: true },
    );
    await withLocalDb(async ({ core }) => {
      await core
        .update(outfitEntries)
        .set({ moderationStatus: "ok" })
        .where(eq(outfitEntries.id, ownEntryId));
    });

    // FEED-10: an old handle names nobody — it says the runner moved on.
    await scene(page, "/@old · this runner changed their name");
    await page.goto(`/@${oldUsername}`);
    await hydrated(page);
    await expect(
      page.getByText("This runner changed their name."),
    ).toBeVisible();
    await expect(page.getByText(otherUsername)).toHaveCount(0);

    await scene(page, "Your own entry: take back one photo");
    await page.goto(`/feed/entry/${ownEntryId}`);
    await hydrated(page);
    await page.getByRole("button", { name: "Delete photo 2" }).click();
    await expect(
      page.getByRole("heading", { name: "Delete photo 2?" }),
    ).toBeVisible();
    await page.getByRole("button", { name: "Delete", exact: true }).click();
    await expect(
      page.getByRole("button", { name: "Delete photo 2" }),
    ).toHaveCount(0);
    await expect(
      page.getByRole("button", { name: "Delete photo 1" }),
    ).toBeVisible();

    await scene(page, "…or the whole entry: its kit, verdict and photos go");
    await page.getByRole("button", { name: "Delete this entry" }).click();
    await expect(
      page.getByRole("heading", { name: "Delete this entry?" }),
    ).toBeVisible();
    await page.getByRole("button", { name: "Delete", exact: true }).click();
    await expect(page).not.toHaveURL(new RegExp(ownEntryId));
    await page.goto(`/feed/entry/${ownEntryId}`);
    await expect(page).not.toHaveURL(new RegExp(ownEntryId));
  } finally {
    await forgetPlace(viewerId);
    await withLocalDb(async ({ core }) => {
      // Only what the deletes above did not reach, if a beat failed first.
      await core.delete(entryPhotos).where(eq(entryPhotos.entryId, ownEntryId));
      await core.delete(outfitEntries).where(eq(outfitEntries.id, ownEntryId));
      await core.delete(runs).where(eq(runs.id, ownRunId));
    });
    await withLocalDb(async ({ core, weather }) => {
      await core.delete(runs).where(eq(runs.id, oldRunId));
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
        .delete(usernameHistory)
        .where(eq(usernameHistory.username, oldUsername));
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
