/**
 * Covers, beside `verdict.journey.spec.ts`: DS2, the verdict backlog —
 * the same act as A3, done from a table instead of six sheets: two runs
 * with no outfit are a queue, Use takes the usual kit, 1–5 sets the
 * verdict on A3's own scale, Enter saves, and the saved row is gone on
 * the next visit.
 */
import { inArray } from "drizzle-orm";

import {
  outfitEntries,
  outfitEntryItems,
  runs,
  wardrobeItems,
} from "../../src/db/schema-core";
import { weatherObservations } from "../../src/db/schema-weather";
import { newUlid } from "../../src/lib/ids";
import { nowSeconds } from "../../src/lib/now";
import { userIdOf } from "../conformance/logging-fixtures";
import { storageStateFor } from "../support/accounts";
import { expect, test } from "../support/a11y";
import { hydrated } from "../support/demo";
import { withLocalDb } from "../support/local-db";

test.use({ storageState: storageStateFor("verdict") });

test("DS2 · two runs with no outfit are a queue: 1–5 sets the verdict, Enter saves", async ({
  page,
}) => {
  // The verdict journey's place: observations are cached by rounded
  // lat/lng/hour, and these hours are clear of the journey's own.
  const latR = 40.71;
  const lngR = -74.01;
  const startedAt = nowSeconds() - 3600;
  // "The phone version is six S1 prompts, each opening an A3 sheet — six
  // round trips for six decisions the runner can make in twelve seconds
  // once the conditions and their usual kit are side by side."
  //
  // Two imported runs with no outfit, which is what the queue is made of.
  // Two, because one is a sheet: "only reachable when >=2 runs lack a
  // verdict; with one, the S1 prompt opens A3 in the panel like the
  // phone."
  const backlogRuns = [newUlid(), newUlid()];
  // And one judged run in the same conditions, with a piece on it: the
  // usual kit Use offers, whatever else this account has logged.
  const prior = { runId: newUlid(), entryId: newUlid(), itemId: newUlid() };
  const userId = await userIdOf("verdict");
  await withLocalDb(async ({ core, weather }) => {
    for (const [index, id] of [...backlogRuns, prior.runId].entries()) {
      // Distinct hours at the same place: an observation is keyed by
      // rounded lat/lng and hour bucket, so two runs in one hour would be
      // one row and the second insert a UNIQUE violation.
      const at = startedAt - (index + 2) * 3600;
      await core.insert(runs).values({
        id,
        userId,
        title: `Imported run ${String(index + 1)}`,
        startedAt: at,
        durationS: 2400,
        distanceM: 7000,
        source: "file",
        indoor: false,
        weatherStatus: "attached",
        lat: latR,
        lng: lngR,
      });
      // Upsert: an observation is keyed by rounded place and hour, so a
      // second run of this spec on the same local database would collide
      // rather than re-seed.
      await weather
        .insert(weatherObservations)
        .values({
          id: newUlid(),
          latR,
          lngR,
          hourBucket: Math.floor(at / 3600),
          tempC: 6,
          feelsLikeC: 4,
          humidity: 70,
          windKph: 12,
          precipMm: 0,
          condition: "clear",
          source: "visualcrossing",
          fetchedAt: at,
        })
        .onConflictDoUpdate({
          target: [
            weatherObservations.latR,
            weatherObservations.lngR,
            weatherObservations.hourBucket,
          ],
          set: { tempC: 6, feelsLikeC: 4 },
        });
    }
    await core.insert(wardrobeItems).values({
      id: prior.itemId,
      userId,
      category: "top",
      name: "Backlog long sleeve",
      origin: "manual",
      createdAt: startedAt - 86_400,
    });
    await core.insert(outfitEntries).values({
      id: prior.entryId,
      runId: prior.runId,
      userId,
      verdict: 0,
      audience: "private",
      createdAt: startedAt,
    });
    await core
      .insert(outfitEntryItems)
      .values({ entryId: prior.entryId, itemId: prior.itemId });
  });

  try {
    await page.goto("/feed");
    await hydrated(page);
    await page.getByRole("link", { name: /Clear the queue/ }).click();
    await hydrated(page);

    // **Counts are relative, not absolute.** This spec seeds and does not
    // reset the local database, so a developer running it twice has the
    // previous run's rows still waiting. What is true either way is that
    // two more arrived, one of them saves, and the saved one is gone next
    // visit.
    //
    // The wait is not decoration: `count()` does not auto-wait, so reading
    // it straight after a navigation reads zero rows on a table that has
    // simply not rendered yet.
    await expect(
      page.getByRole("heading", { level: 1, name: "Verdicts" }),
    ).toBeVisible({ timeout: 15_000 });
    await expect(page.getByRole("row").nth(2)).toBeVisible();
    const rowsBefore = await page.getByRole("row").count();
    expect(rowsBefore).toBeGreaterThanOrEqual(3);
    await page.getByRole("button", { name: "Use" }).first().click();

    // The keyboard is the reason the surface exists: 1–5 sets the verdict,
    // Enter saves and moves on. The scale is A3's own, not a coarser one.
    await page.getByRole("row").nth(1).press("3");
    await expect(
      page.getByRole("button", { name: /^Dialed —/ }).first(),
    ).toHaveAttribute("aria-pressed", "true");
    await page.getByRole("row").nth(1).press("Enter");

    // "Verdicts saved here count exactly like verdicts from the phone."
    await expect(page.getByText(/1 of \d+ saved/)).toBeVisible({
      timeout: 15_000,
    });
    // "It leaves the list on the next visit, not on save — motion has no
    // 'row flies away'."
    await expect(page.getByRole("row")).toHaveCount(rowsBefore);

    await page.reload();
    await hydrated(page);
    await expect(page.getByRole("row")).toHaveCount(rowsBefore - 1);
  } finally {
    // The seed is this spec's to clear. Without it the backlog grows by two
    // every local run, and the next spec inherits a queue it did not make.
    const seededRuns = [...backlogRuns, prior.runId];
    await withLocalDb(async ({ core }) => {
      const entries = await core
        .select({ id: outfitEntries.id })
        .from(outfitEntries)
        .where(inArray(outfitEntries.runId, seededRuns));
      const entryIds = entries.map((entry) => entry.id);
      if (entryIds.length > 0) {
        await core
          .delete(outfitEntryItems)
          .where(inArray(outfitEntryItems.entryId, entryIds));
      }
      await core
        .delete(outfitEntries)
        .where(inArray(outfitEntries.runId, seededRuns));
      await core.delete(runs).where(inArray(runs.id, seededRuns));
      await core
        .delete(wardrobeItems)
        .where(inArray(wardrobeItems.id, [prior.itemId]));
    });
  }
});
