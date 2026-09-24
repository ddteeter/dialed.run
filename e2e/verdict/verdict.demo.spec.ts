/**
 * Covers: A3 (log the verdict), A3b (anything specific) — choosing a
 * verdict, flagging a kit item from the generated chips and a tag from A3b,
 * Noted landing in the submit's place with the chips kept read-only and
 * MORE gone (round 21), seeing the verdict on the entry, and re-opening
 * the verdict to find the flag still there — and DS2, the verdict
 * backlog, which is the same act done from a table instead of six sheets.
 * One journey, one video.
 *
 * The photo is not here any more: round 20 moved the outfit photo from A3
 * to A2, and its beat moved with it, to `e2e/run-logging/`.
 *
 * Why this exists separately from feed.demo.spec.ts: that one is the
 * *reader's* journey (follow, browse, open, mark useful) and its Covers
 * header claims A3 only as a display. Nothing demonstrated the writer's
 * half.
 */
import { eq, inArray } from "drizzle-orm";

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
import { nowSeconds } from "../../src/lib/now";

/** Layout stamps html[data-hydrated] once React attaches; driving
 *  controlled inputs before that races hydration's state reset. */
async function hydrated(page: import("@playwright/test").Page): Promise<void> {
  await page
    .locator('html[data-hydrated="true"]')
    .waitFor({ state: "attached" });
}

test("log a verdict on your own run: pick it, flag an item, read the receipt", async ({
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
  // An earlier run in the same band, the Houdini on it and called cold —
  // the history A3's chips are generated from. Without one the kit has no
  // record here, and the chip rule suggests no garment at all.
  const priorRunId = newUlid();
  const priorEntryId = newUlid();

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
  const startedAt = nowSeconds() - 3600;
  const priorStartedAt = startedAt - 7 * 86_400;
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

    await core.insert(runs).values({
      id: priorRunId,
      userId: row.id,
      title: "Last week's loop",
      startedAt: priorStartedAt,
      durationS: 2700,
      distanceM: 8000,
      source: "manual",
      indoor: false,
      weatherStatus: "attached",
      lat: latR,
      lng: lngR,
    });
    await core.insert(outfitEntries).values({
      id: priorEntryId,
      userId: row.id,
      runId: priorRunId,
      verdict: -1,
      isPublic: false,
      createdAt: priorStartedAt,
    });
    await core
      .insert(outfitEntryItems)
      .values({ entryId: priorEntryId, itemId });
  });

  // Seed the conditions this entry was logged in. Without an observation
  // the screen has no temperature band, and saving takes a different
  // branch — so this is seeded deliberately rather than left to chance.
  //
  // Both runs, each at its own hour: the earlier one has to land in the
  // same band for its verdict to count as history here.
  await withLocalDb(async ({ weather }) => {
    for (const [id, run, at] of [
      [observationId, runId, startedAt],
      [newUlid(), priorRunId, priorStartedAt],
    ] as const) {
      await weather
        .insert(weatherObservations)
        .values({
          id,
          runId: run,
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
        // (lat_r, lng_r, hour_bucket) is the cache key and is UNIQUE, so a
        // re-run inside the same hour hits the row the last run left.
        // Upsert rather than insert: the spec has to be re-runnable, and
        // the values below are the ones its assertions depend on.
        .onConflictDoUpdate({
          target: [
            weatherObservations.latR,
            weatherObservations.lngR,
            weatherObservations.hourBucket,
          ],
          set: {
            runId: run,
            tempC: 6,
            feelsLikeC: 4,
            source: "visualcrossing",
          },
        });
    }
  });

  // The way in: an entry with no verdict asks for one, once. The panel
  // wears round 21's --dialed-tint behind a teal border.
  await page.goto(`/feed/entry/${entryId}`);
  await hydrated(page);
  await scene(page, "An entry with no verdict asks for one");
  const prompt = page.getByRole("link", {
    name: "You didn’t log a verdict for this run. Add one?",
  });
  await expect(prompt).toBeVisible();
  await prompt.click();
  await page.waitForURL(`**/feed/verdict/${entryId}`);
  await hydrated(page);

  // A3: the five-point scale, coldest to warmest, from the one shared
  // verdictScale rather than a per-screen copy.
  await scene(page, "A3 · five points, coldest to warmest, one scale");
  await page.getByRole("button", { name: "A bit cold" }).click();

  // D-97: beneath the row, this runner's own history in the run's band —
  // loaded by the route all along, and until round 20 never shown.
  await scene(page, "Beneath the row: your history in this band");
  await expect(page.getByText(/^Five states\./)).toBeVisible();

  // Round 20: the chips are generated, never composed. The Houdini was
  // called cold here last week, so a cold verdict suggests it "not
  // enough"; tags fill the row to five. Per-item signal is a flag, never a
  // second verdict (CLAUDE.md).
  await scene(page, "Five chips, generated from your history in this band");
  const houdini = page.getByRole("button", {
    name: "Houdini Jacket not enough",
  });
  await houdini.click();
  await expect(houdini).toHaveAttribute("aria-pressed", "true");

  // MORE › opens A3b: every garment's triple and all nine tags — how
  // something the chips did not suggest gets said.
  await scene(page, "MORE opens A3b: every garment, all nine tags");
  await page.getByRole("button", { name: "More ›" }).click();
  const sheet = page.getByRole("dialog", { name: "Anything specific?" });
  await sheet.getByRole("button", { name: "hands cold" }).click();
  await sheet.getByRole("button", { name: "Done" }).click();
  await expect(sheet).toBeHidden();
  await expect(
    page.getByRole("button", { name: "hands cold" }),
  ).toHaveAttribute("aria-pressed", "true");

  await scene(page, "Saving reports the wear rate in this temperature band");
  await page.getByRole("button", { name: "Log it" }).click();

  // With conditions resolved, saving reports the item's wear rate in this
  // temperature band rather than navigating away — the calibration signal
  // that makes a verdict worth logging.
  await expect(page.getByText(/Houdini Jacket is now \d+ of \d+/)).toBeVisible({
    timeout: 15_000,
  });
  // Round 20: Noted is a receipt in the submit's place. Share and Log it
  // give way to it, and the answer stays on screen, read-only, so the
  // receipt is read against it.
  await scene(page, "Noted takes the submit's place — the answer stays");
  await expect(page.getByRole("button", { name: "Log it" })).toHaveCount(0);
  await expect(
    page.getByRole("button", { name: "A bit cold" }),
  ).toHaveAttribute("aria-pressed", "true");
  // Round 21: MORE leaves with share and submit, and a chosen chip keeps
  // its ink and loses its close glyph — a receipt makes no offers.
  await scene(page, "The chips stay, read-only; MORE is gone");
  await expect(page.getByRole("button", { name: "More ›" })).toHaveCount(0);
  await expect(
    page.getByRole("button", { name: "Houdini Jacket not enough" }),
  ).toHaveAttribute("aria-disabled", "true");

  // And the verdict is on the entry.
  await scene(page, "And the verdict is on the entry");
  await page.goto(`/feed/entry/${entryId}`);
  // D's badge, by the part lane 123's D names it. The `.or()` is main's
  // bracketed badge until that lands, and goes when it does.
  const badge = page
    .locator('[data-part="verdict-badge"]')
    .or(page.getByText("[A bit cold]"));
  await expect(badge).toBeVisible({ timeout: 15_000 });
  await expect(badge).toHaveText(/^\[?A bit cold\]?$/u);

  // Re-opening it shows what was saved, which is not what it used to do.
  //
  // The flag pickers were seeded empty rather than from
  // `entry.items[].flag`, so coming back here showed every piece as
  // unflagged — and saving again wrote that emptiness over the flag the
  // runner had set. Nothing said so; the screen just quietly disagreed
  // with the database.
  await page.goto(`/feed/verdict/${entryId}`);
  await hydrated(page);
  await expect(
    page.getByRole("button", { name: "Houdini Jacket not enough" }),
  ).toHaveAttribute("aria-pressed", "true");

  // ---- DS2 · the same act, from a table ------------------------------
  //
  // "The phone version is six S1 prompts, each opening an A3 sheet — six
  // round trips for six decisions the runner can make in twelve seconds
  // once the conditions and their usual kit are side by side."
  //
  // Two imported runs with no outfit, which is what the queue is made of.
  // Two, because one is a sheet: "only reachable when >=2 runs lack a
  // verdict; with one, the S1 prompt opens A3 in the panel like the
  // phone."
  const backlogRuns = [newUlid(), newUlid()];
  await withLocalDb(async ({ core, weather }) => {
    const [row] = await core
      .select({ id: user.id })
      .from(user)
      .where(eq(user.email, email))
      .limit(1);
    if (!row) throw new Error("signup did not create a user row");

    for (const [index, id] of backlogRuns.entries()) {
      // Distinct hours at the same place: an observation is keyed by
      // rounded lat/lng and hour bucket, so two runs in one hour would be
      // one row and the second insert a UNIQUE violation.
      const at = startedAt - (index + 2) * 3600;
      await core.insert(runs).values({
        id,
        userId: row.id,
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
      // Upsert, like the seed above and for the same reason: an
      // observation is keyed by rounded place and hour, so a second run
      // of this spec on the same local database would collide rather
      // than re-seed.
      await weather
        .insert(weatherObservations)
        .values({
          id: newUlid(),
          runId: id,
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
          set: { runId: id, tempC: 6, feelsLikeC: 4 },
        });
    }
  });

  await scene(page, "Two runs with no outfit is a queue, not six sheets");
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
    page.getByRole("heading", { name: "Needs a verdict" }),
  ).toBeVisible({ timeout: 15_000 });
  await expect(page.getByRole("row").nth(2)).toBeVisible();
  const rowsBefore = await page.getByRole("row").count();
  expect(rowsBefore).toBeGreaterThanOrEqual(3);
  await scene(page, "Same kit, same conditions — take it and judge it");
  await page.getByRole("button", { name: "Use" }).first().click();

  // The keyboard is the reason the surface exists: 1–5 sets the verdict,
  // Enter saves and moves on. The scale is A3's own, not a coarser one.
  await scene(page, "1–5 sets the verdict, Enter saves — A3's own scale");
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

  await scene(page, "Next visit, and the row it was is gone");
  await page.reload();
  await hydrated(page);
  await expect(page.getByRole("row")).toHaveCount(rowsBefore - 1);

  // The seed is this spec's to clear. Without it the backlog grows by two
  // every local run, and the next spec inherits a queue it did not make.
  await withLocalDb(async ({ core }) => {
    await core
      .delete(outfitEntries)
      .where(inArray(outfitEntries.runId, backlogRuns));
    await core.delete(runs).where(inArray(runs.id, backlogRuns));
  });
});
