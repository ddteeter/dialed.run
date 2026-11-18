/**
 * Covers, beside `run-logging.journey.spec.ts`: R2b (setting conditions
 * by picking a band and a sky, never typing a number — round 26 item 2),
 * deleting a run from its own page (task 128 · SAF-3), the retired import
 * URL landing on A1, and A1 reading a Garmin TCX of many laps as the whole
 * run (R-130) and a paused TCX at its elapsed time (D-111), and A2 once
 * the day's photos are used up: the kit is logged, the photo row says so,
 * and the photo stays held.
 *
 * Each test removes what it seeded, and what its uploads made, through the
 * conformance fixtures the journey uses too.
 */
import { readFileSync } from "node:fs";

import type { Locator, Page } from "@playwright/test";
import { and, eq } from "drizzle-orm";

import { rateLimits } from "../../src/db/schema-core";
import {
  PHOTO_LIMIT_REACHED,
  PHOTO_UPLOADS_PER_DAY,
} from "../../src/lib/photo-constraints";
import { PNG_1X1 } from "../closet/closet-support";
import { withLocalDb } from "../support/local-db";

import {
  distanceNumber,
  formatDuration,
  formatPace,
} from "../../src/lib/contracts/measures";
import { newUlid } from "../../src/lib/ids";
import { nowSeconds } from "../../src/lib/now";
import {
  gpx,
  hydrated,
  seedItem,
  seedObservation,
  seedRun,
  unseed,
  unseedObservations,
  userIdOf,
} from "../conformance/logging-fixtures";
import type { Seeded } from "../conformance/logging-fixtures";
import { storageStateFor } from "../support/accounts";
import { expect, test } from "../support/a11y";
import { PHONE } from "../support/bars";

test.use({ storageState: storageStateFor("run-logging") });

/**
 * The parser suite's Garmin fixture: five 1609.34m auto-laps and a short
 * last lap, as a Forerunner writes them. Its laps sum to 2509.4 seconds and
 * 8459.4 metres; its first lap alone is 482 seconds and one mile, which is
 * what A1 read before R-130.
 */
const SIX_LAPS = new URL(
  "../../test/runs/fixtures/multi-lap.tcx",
  import.meta.url,
);
const SIX_LAPS_SECONDS = 2509;
const SIX_LAPS_METRES = 8459.4;

/**
 * The parser suite's paused fixture: two 600-second laps with the watch
 * paused three minutes between them. Elapsed is 1380 seconds, which is what
 * the card reads since D-111; timer time is the laps' 1200, which is what
 * it read before. Pace on screen is elapsed-based until design 130's read
 * API gives moving pace.
 */
const PAUSED = new URL(
  "../../test/runs/fixtures/paused-climb.tcx",
  import.meta.url,
);
const PAUSED_ELAPSED_SECONDS = 1380;
const PAUSED_TIMER_SECONDS = 1200;
const PAUSED_METRES = 3800;

async function seededFor(): Promise<Seeded> {
  return {
    userId: await userIdOf("run-logging"),
    runIds: [],
    itemIds: [],
    entryIds: [],
  };
}

/**
 * A1 with a Garmin file dropped on it, read to its parsed card.
 */
async function dropTcx(page: Page, name: string, file: URL): Promise<Locator> {
  await page.goto("/runs/new");
  await hydrated(page);
  await page.setInputFiles('[data-part="drop-zone"] input[type="file"]', {
    name,
    mimeType: "application/vnd.garmin.tcx+xml",
    buffer: readFileSync(file),
  });
  await expect(page.getByText(`Parsed · ${name}`)).toBeVisible({
    timeout: 20_000,
  });
  return page.locator('[data-slot="parsed-card"]');
}

test("R2b · no weather came back: set it by picking, never typing, then delete the run", async ({
  page,
}) => {
  // A run the weather gave up on — seeded, because the provider is not
  // this spec's business.
  const seeded = await seededFor();
  try {
    const staleRunId = await seedRun(seeded, {
      observed: false,
      weatherStatus: "failed",
      startedAt: nowSeconds() - 10 * 86_400,
    });
    await page.goto("/runs");
    await hydrated(page);
    const stale = page.locator('[data-slot="run-row"]').filter({
      has: page.locator(`a[href="/runs/${staleRunId}"]`),
    });
    // Round 55 · 235: the control is the row's one badge, and its line
    // keeps only the distance.
    await expect(stale).not.toContainText("No weather for this time");
    await stale.getByRole("button", { name: /Set conditions/u }).click();
    const sheet = page.getByRole("dialog", { name: "No weather saved" });
    await expect(sheet).toBeVisible();
    await sheet
      .getByRole("button", { name: "Set conditions", exact: true })
      .click();
    // Two picks, nothing preselected: how warm, and the sky.
    const picks = page.getByRole("dialog", { name: "Set conditions" });
    await expect(picks.getByRole("radio", { checked: true })).toHaveCount(0);
    await expect(picks.locator("input:not([type='radio'])")).toHaveCount(0);
    // The band for 10–15 °C, in whichever unit the runner reads.
    await picks.getByRole("radio").nth(6).check();
    await picks.getByRole("radio", { name: "Rain" }).check();
    await picks.getByRole("button", { name: /^Set .+ and rain$/u }).click();
    await expect(picks).toBeHidden({ timeout: 15_000 });
    // The badge says the range and the sky, never a midpoint.
    await expect(stale).toContainText(/Set · .+ · Rain/u, { timeout: 15_000 });

    // ---- Delete a run (task 128 · SAF-3) --------------------------------
    // A run you'd rather not keep — delete it from its page. The sheet
    // says what goes with it; then it's gone.
    await page.goto(`/runs/${staleRunId}`);
    await hydrated(page);
    await page.getByRole("button", { name: "Delete this run" }).click();
    await expect(
      page.getByRole("heading", { name: "Delete this run?" }),
    ).toBeVisible();
    await page.getByRole("button", { name: "Delete", exact: true }).click();
    await expect(page).toHaveURL(/\/runs$/u);
    await expect(page.locator(`a[href="/runs/${staleRunId}"]`)).toHaveCount(0);
  } finally {
    await unseed(seeded);
  }
});

test("the old import page is gone: its URL lands on A1", async ({ page }) => {
  await page.goto(`/runs/import/${newUlid()}`);
  await hydrated(page);
  await expect(page).toHaveURL(/\/runs\/new$/u);
});

/**
 * The runner's count of photo uploads for the day, set to the limit, so
 * the next upload is refused (`photo-runner`, keyed by the runner's id).
 */
async function usePhotosUp(userId: string): Promise<void> {
  await withLocalDb(async ({ core }) => {
    await core
      .insert(rateLimits)
      .values({
        kind: "photo-runner",
        subject: userId,
        windowStartedAt: nowSeconds(),
        count: PHOTO_UPLOADS_PER_DAY,
      })
      .onConflictDoUpdate({
        target: [rateLimits.kind, rateLimits.subject],
        set: { windowStartedAt: nowSeconds(), count: PHOTO_UPLOADS_PER_DAY },
      });
  });
}

async function forgetPhotoCount(userId: string): Promise<void> {
  await withLocalDb(async ({ core }) => {
    await core
      .delete(rateLimits)
      .where(
        and(
          eq(rateLimits.kind, "photo-runner"),
          eq(rateLimits.subject, userId),
        ),
      );
  });
}

test("A2 · the day's photos are used up: the row says so, and the photo stays held", async ({
  page,
}) => {
  const seeded = await seededFor();
  try {
    const runId = await seedRun(seeded, {
      observed: true,
      weatherStatus: "attached",
    });
    await seedItem(seeded, "Photo limit top", "top");
    await usePhotosUp(seeded.userId);

    await page.goto(`/feed/attach/${runId}`);
    await hydrated(page);
    await page.getByRole("button", { name: "Photo limit top" }).click();
    await page.setInputFiles('[data-part="add-photo"] input[type="file"]', {
      name: "kit.png",
      mimeType: "image/png",
      buffer: PNG_1X1,
    });
    const blurSheet = page.getByRole("dialog", { name: "Check the blur" });
    await blurSheet
      .getByRole("button", { name: "Use this photo" })
      .click({ timeout: 20_000 });
    await expect(blurSheet).toBeHidden();

    await page.getByRole("button", { name: "Next — did it work?" }).click();
    await expect(page.getByText(PHOTO_LIMIT_REACHED)).toBeVisible({
      timeout: 15_000,
    });
    await expect(page).toHaveURL(/\/feed\/attach\//u);
    await expect(
      page.getByRole("button", { name: "Photo 1 of 1" }),
    ).toBeVisible();
  } finally {
    await forgetPhotoCount(seeded.userId);
    await unseed(seeded);
  }
});

test("A1 · a Garmin file writes a lap a mile, and A1 reads every lap (R-130)", async ({
  page,
}) => {
  const seeded = await seededFor();
  try {
    const card = await dropTcx(page, "forerunner_six_laps.tcx", SIX_LAPS);
    // Five auto-lap miles and a short last one, all counted. The card's
    // headline in the app's own formatters: "5.3 mi · 41:49", where the
    // first lap alone read "1.0 mi · 8:02".
    await expect(card).toContainText(
      `${distanceNumber(SIX_LAPS_METRES, "mi")} mi · ${formatDuration(SIX_LAPS_SECONDS)}`,
    );
  } finally {
    await unseed(seeded);
  }
});

test("A1 · a pause is part of the run's time (D-111)", async ({ page }) => {
  const seeded = await seededFor();
  try {
    // A run with a stop in it — the watch paused at a light.
    const card = await dropTcx(page, "paused_at_the_light.tcx", PAUSED);
    // "2.4 mi · 23:00", where the laps' timer time read "2.4 mi · 20:00";
    // the pace beside it is elapsed pace too.
    await expect(card).toContainText(
      `${distanceNumber(PAUSED_METRES, "mi")} mi · ${formatDuration(PAUSED_ELAPSED_SECONDS)}`,
    );
    await expect(card).not.toContainText(formatDuration(PAUSED_TIMER_SECONDS));
    await expect(card).toContainText(
      formatPace(PAUSED_ELAPSED_SECONDS, PAUSED_METRES, "mi") ?? "",
    );
  } finally {
    await unseed(seeded);
  }
});

/**
 * A1 as the phone has it once the file is read: the parsed card with its
 * conditions arrived, and the start-time row open in place. It ends here
 * so what a screen reader says on both is checked in (#582); the journey
 * walks the same beat at the desk and goes on.
 */
test.describe("A1 at the phone's width", () => {
  // The seeded observation is Chicago's, and the card reads on the
  // device's clock until its conditions land.
  test.use({ viewport: PHONE, timezoneId: "America/Chicago" });

  test("A1 · the conditions have arrived, and the start-time row is open", async ({
    page,
  }) => {
    const seeded = await seededFor();
    // Hours ago, so it never reads as a run already logged.
    const fileStart = (Math.floor(nowSeconds() / 3600) - 5) * 3600 + 4 * 60;
    const observations = [
      await seedObservation(Math.floor(fileStart / 3600), {
        tempC: 2,
        precipMm: 0,
      }),
    ];
    try {
      await page.goto("/runs/new");
      await hydrated(page);
      await page.setInputFiles('[data-part="drop-zone"] input[type="file"]', {
        name: "morning_run.gpx",
        mimeType: "application/gpx+xml",
        buffer: gpx(fileStart, 6),
      });
      await expect(page.getByText("Parsed · morning_run.gpx")).toBeVisible({
        timeout: 20_000,
      });
      await expect(page.locator('[data-slot="conditions"]')).toContainText(
        "36°F",
        { timeout: 20_000 },
      );

      await page
        .getByRole("button", { name: /^[0-9:]+ [AP]M Change$/u })
        .click();
      await expect(page.getByLabel("Start time")).toBeFocused();
    } finally {
      await unseed(seeded);
      await unseedObservations(observations);
    }
  });
});
