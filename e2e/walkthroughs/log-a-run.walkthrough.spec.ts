/**
 * Walkthrough · logging a run (design 180, step 5): a file from the
 * watch, the conditions it ran in found on their own, the kit picked from
 * the closet, and the verdict with its receipt. The closet is seeded, and
 * so is the hour's weather, as the attach path caches it: never stubbed.
 * The run-logging and verdict journeys (`e2e/run-logging/`,
 * `e2e/verdict/`) carry the edge cases.
 */
import { formatDuration } from "../../src/lib/contracts/measures";
import { nowSeconds } from "../../src/lib/now";
import {
  gpx,
  seedItem,
  seedObservation,
  unseedObservations,
} from "../conformance/logging-fixtures";
import type { Seeded } from "../conformance/logging-fixtures";
import { launcher } from "../support/bars";
import { hydrated, scene } from "../support/demo";
import { expect, test } from "../support/walkthrough";

/**
Forty minutes: 41 track points, a minute apart.
*/
const TRACK_POINTS = 41;

test("log a run: the file, its conditions, the kit, the verdict", async ({
  page,
  runner,
}, testInfo) => {
  // Recording pace is not a latency budget; this catches a hang.
  testInfo.setTimeout(150_000);

  const seeded: Seeded = {
    userId: runner.userId,
    runIds: [],
    itemIds: [],
    entryIds: [],
  };
  await seedItem(seeded, "Merino half-zip", "top");
  await seedItem(seeded, "Running tights", "bottom");
  // This morning's run, three hours back and inside one hour, so the one
  // seeded reading is all the weather it needs: 2 °C, dry.
  const fileStart = (Math.floor(nowSeconds() / 3600) - 3) * 3600 + 4 * 60;
  const observations = [
    await seedObservation(Math.floor(fileStart / 3600), {
      tempC: 2,
      precipMm: 0,
    }),
  ];

  try {
    await page.goto("/closet");
    await hydrated(page);
    await launcher(page).click();
    await hydrated(page);
    const well = page.locator('[data-part="drop-zone"]');
    await expect(well).toContainText("Drop a file, or browse");
    await scene(page, "Log a run · drop the file from your watch", {
      say: "Logging a run starts with the file from your watch, or any tracking app. Drop it here.",
    });

    await page.setInputFiles('[data-part="drop-zone"] input[type="file"]', {
      name: "morning_run.gpx",
      mimeType: "application/gpx+xml",
      buffer: gpx(fileStart, TRACK_POINTS),
    });
    const card = page.locator('[data-slot="parsed-card"]');
    await expect(card).toContainText("Parsed · morning_run.gpx", {
      timeout: 20_000,
    });
    await expect(card).toContainText(formatDuration((TRACK_POINTS - 1) * 60));
    await expect(
      card.getByRole("button", { name: /, change start time$/u }),
    ).toBeVisible();
    await expect(page).toHaveURL(/\/runs\/new$/u);
    await scene(page, "Read in place · distance, time, pace", {
      say: "It reads right here, without leaving the page: the distance, the time, the pace, and when you started.",
    });

    const conditions = page.locator('[data-slot="conditions"]');
    await expect(conditions).toContainText("36°F", { timeout: 20_000 });
    await conditions.scrollIntoViewIfNeeded();
    await scene(page, "Conditions · found, never typed", {
      say: "And the conditions come with it, found for when and where you ran. Nobody types the weather.",
    });

    await page
      .getByRole("link", { name: "Looks right — what did you wear?" })
      .click();
    await hydrated(page);
    await expect(
      page.getByRole("heading", { name: "What did you wear?" }),
    ).toBeVisible();
    await page.getByRole("button", { name: "Merino half-zip" }).click();
    await page.getByRole("button", { name: "Running tights" }).click();
    await expect(page.getByText(/2 pieces$/u)).toBeVisible();
    await scene(page, "The kit · picked from your closet", {
      say: "Next, what you wore. The kit is picked from your closet, a tap per piece.",
    });

    await page.getByRole("button", { name: "Next — did it work?" }).click();
    await page.waitForURL("**/feed/verdict/**");
    await hydrated(page);
    const scale = [
      "Way cold",
      "A bit cold",
      "Dialed",
      "A bit warm",
      "Way warm",
    ];
    for (const point of scale) {
      await expect(page.getByRole("button", { name: point })).toBeVisible();
    }
    await scene(page, "The verdict · cold to warm, dialed in the middle", {
      say: "Then the verdict: did it work? Five points, from way cold to way warm, with dialed in the middle.",
    });

    await page.getByRole("button", { name: "Dialed" }).click();
    await expect(page.getByRole("button", { name: "Dialed" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    await page.getByRole("button", { name: "Log it" }).click();
    const noted = page.locator('[data-slot="noted"]');
    await expect(noted).toContainText(/Merino half-zip is now 1 of 1 in /u, {
      timeout: 15_000,
    });
    await expect(page.getByRole("button", { name: "Log it" })).toHaveCount(0);
    await noted.scrollIntoViewIfNeeded();
    await scene(page, "The receipt · a record per piece", {
      say: "Logging it brings a receipt in place of the button. The half-zip now has its first run in this temperature band, and every verdict adds to that record.",
    });
  } finally {
    await unseedObservations(observations);
  }
});
