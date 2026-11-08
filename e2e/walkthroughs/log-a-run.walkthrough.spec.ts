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
  testInfo.setTimeout(400_000);

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
    await expect(
      page.getByRole("link", { name: /Merino half-zip/u }),
    ).toBeVisible();
    await expect(
      page.getByRole("link", { name: /Running tights/u }),
    ).toBeVisible();
    await scene(page, "A runner's Closet · two pieces", {
      say: "This runner went out this morning in two pieces from their Closet: a merino half-zip and running tights. Let's log that run. I'll start from the log button in the bar.",
    });
    await launcher(page).click();
    await hydrated(page);
    const well = page.locator('[data-part="drop-zone"]');
    await expect(well).toContainText("Drop a file, or browse");
    await scene(page, "Log a run · drop the file from your watch", {
      say: "Logging a run starts with the file from your watch, or any tracking app. Drop it here.",
    });
    await scene(page, "This morning's run · a GPX file", {
      say: "I'll drop in this morning's run, a GPX file, forty minutes long.",
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
      say: "It reads right here, without leaving the page: the distance, the time, forty minutes, the pace, and when you started. If the start time is off, you can change it.",
    });

    const conditions = page.locator('[data-slot="conditions"]');
    await expect(conditions).toContainText("36°F", { timeout: 20_000 });
    await conditions.scrollIntoViewIfNeeded();
    await scene(page, "Conditions · found, never typed", {
      say: "And the conditions come with it, found for when and where you ran: 36 degrees. Nobody types the weather, so it's a real reading, not a guess from memory.",
    });
    await scene(page, "Looks right · on to the kit", {
      say: "That all looks right, so I'll go on to what I wore.",
    });

    await page
      .getByRole("link", { name: "Looks right — what did you wear?" })
      .click();
    await hydrated(page);
    await expect(
      page.getByRole("heading", { name: "What did you wear?" }),
    ).toBeVisible();
    await scene(page, "What did you wear? · a tap per piece", {
      say: "What did you wear? The Kit is picked from your Closet, a tap per piece, so there's nothing to type. I'll tap the half-zip and the tights.",
    });
    await page.getByRole("button", { name: "Merino half-zip" }).click();
    await page.getByRole("button", { name: "Running tights" }).click();
    await expect(page.getByText(/2 pieces$/u)).toBeVisible();
    await scene(page, "The Kit · two pieces", {
      say: "Two pieces, and the Kit is done. On to the last question.",
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
      say: "Then the Verdict: did it work? Five points, from way cold to way warm, with dialed in the middle. It's one Verdict for the whole run, not a score per piece.",
    });

    const audience = page.getByRole("group", { name: "Who sees this run" });
    await expect(
      audience.getByRole("radio", { name: /^Shared/u }),
    ).toBeChecked();
    await expect(
      audience.getByRole("radio", { name: /^Private/u }),
    ).not.toBeChecked();
    await expect(audience).toContainText("Runners signed in to dialed.run.");
    await audience.scrollIntoViewIfNeeded();
    await scene(page, "Who sees this run · shared, or private", {
      say: "And who sees this run: it starts as shared, with runners signed in to dialed.run, and one tap makes it private instead. I'll leave it shared.",
    });
    await scene(page, "Dialed · then log it", {
      say: "I was comfortable the whole way, neither cold nor warm, so I'll pick Dialed, and log it.",
    });

    const dialed = page.getByRole("radio", { name: "Dialed", exact: true });
    await dialed.click();
    await expect(dialed).toBeChecked();
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
