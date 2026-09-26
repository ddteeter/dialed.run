/**
 * Covers: A1 (upload, read in place — the parsed card, no import page),
 * A2 (the picker from the first frame, a kit required, the outfit photo
 * through W3's blur), A3 (Noted when nothing moved), R1 (manual entry going
 * on to the outfit, D-102), R (the runs list's badges) and R2b (setting
 * conditions by picking a band, never typing a number).
 *
 * Journey: open the closet -> launch the log flow from the bar -> drop a
 * GPX file and watch it read in place -> A2: try Next with nothing chosen,
 * pick a piece, add a photo -> A3: log it and read the receipt -> enter a
 * run by hand and land on picking its outfit -> the runs list -> set the
 * conditions of a run the weather gave up on -> the retired import URL
 * lands on A1.
 *
 * **It opens on the closet rather than on `/runs/new`, and that is the
 * point of the first beat** (task 117). A `page.goto` is a document load,
 * which is a first paint — NAV types it `cut`, so a demo that jumps
 * straight to a screen records none of the move that gets it there. Going
 * in through the bar records two things at once: the `rise` that lays the
 * flow over where the runner was, and D-80's other half — the Closet tab
 * stays lit underneath, because `+ Add` is a launcher and not a tab.
 *
 * Exactly one test() per demo spec. A second test here would record a
 * second video beside the one the reviewer is meant to watch; standalone
 * assertions belong in a sibling *.spec.ts.
 *
 * Deliberately excluded: Strava OAuth (no credentials, and the connect flow
 * redirects off-app so it can't be recorded).
 */
import { newUlid } from "../../src/lib/ids";
import { nowSeconds } from "../../src/lib/now";
import {
  gpx,
  hydrated,
  seedItem,
  seedRun,
  unseed,
  userIdOf,
} from "../conformance/logging-fixtures";
import type { Seeded } from "../conformance/logging-fixtures";
import { storageStateFor } from "../support/accounts";
import { DESK, PHONE, bar, launcher } from "../support/bars";
import { expect, scene, test } from "../support/demo";

// Signed in already: the account is created by the `demo-setup` project, so
// this video opens on logging a run rather than on a signup form.
test.use({ storageState: storageStateFor("run-logging") });

/**
 * A real 1x1 PNG — a decodable image rather than bytes with an image/png
 * label, because the blur step decodes what it is given.
 */
const PNG_1X1 = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
  "base64",
);

test("log a run: read a file in place, pick the kit, note it, set conditions", async ({
  page,
}, testInfo) => {
  // Generous, because recording pace is not a latency budget. `scene()`
  // holds a beat at each boundary and slowMo paces the actions between
  // them (D-58), so a recorded run takes minutes where CI's takes seconds.
  testInfo.setTimeout(180_000);

  // A piece to wear, and a run the weather gave up on for R2b — seeded,
  // because the closet and the provider are other journeys' business.
  // The conformance fixtures' own seeding and clean-up, so this journey and
  // the specs that share its account take out the same rows.
  const seeded: Seeded = {
    userId: await userIdOf("run-logging"),
    runIds: [],
    itemIds: [],
    entryIds: [],
  };
  await seedItem(seeded, "Demo half-zip", "top");
  const staleRunId = await seedRun(seeded, {
    observed: false,
    weatherStatus: "failed",
    startedAt: nowSeconds() - 10 * 86_400,
  });

  try {
    await page.goto("/closet");
    await hydrated(page);

    // **Phone width for this beat, deliberately.** Everything below is the
    // five-tab footer's own behaviour — the held tab, the launcher that
    // takes a seat without owning a path — and from BREAKPOINT.wide up
    // there is no footer at all (Desktop Contract DS1).
    await page.setViewportSize(PHONE);
    await scene(
      page,
      "Phone width, on purpose — the five-tab bar exists only below 720",
    );
    await scene(page, "Logging a run is laid over wherever you were");
    await launcher(page).click();
    await hydrated(page);
    await expect(
      page.locator('[data-slot="tab-indicator"] span'),
    ).toBeVisible();
    await expect(
      bar(page).getByRole("link", { name: "Closet" }),
    ).toHaveAttribute("aria-current", "true");
    await expect(launcher(page)).toHaveAttribute("aria-haspopup", "dialog");
    await expect(bar(page).locator('[aria-current="page"]')).toHaveCount(0);

    // ---- A1 · the file reads in place --------------------------------
    await scene(page, "A1 · drop a file — it reads here, nothing navigates");
    const well = page.locator('[data-part="drop-zone"]');
    await page.setInputFiles('[data-part="drop-zone"] input[type="file"]', {
      name: "morning_run.gpx",
      mimeType: "application/gpx+xml",
      // Hours ago, so it never reads as a run already logged.
      buffer: gpx(nowSeconds() - 3 * 3600, 6),
    });
    await expect(well).toHaveAttribute("data-state", "uploading");
    await expect(page).toHaveURL(/\/runs\/new$/u);

    await scene(page, "The parsed card lands where the drop zone was");
    await expect(page.getByText("Parsed · morning_run.gpx")).toBeVisible({
      timeout: 20_000,
    });
    await expect(page).toHaveURL(/\/runs\/new$/u);
    await page
      .getByRole("link", { name: "Looks right — what did you wear?" })
      .click();
    await hydrated(page);

    // ---- A2 · the kit, required, and the photo -----------------------
    await scene(page, "A2 · the picker is here from the first frame");
    await expect(page.getByText(/0 pieces/u)).toBeVisible();
    await scene(page, "A kit is required — the button never relabels");
    await page.getByRole("button", { name: "Next — did it work?" }).click();
    await expect(page.getByText("Pick at least one piece.")).toBeVisible();

    await page.getByRole("button", { name: "Demo half-zip" }).click();
    await expect(page.getByText(/1 piece$/u)).toBeVisible();
    await expect(page.getByText("Pick at least one piece.")).toHaveCount(0);

    await scene(page, "The outfit photo lives here now, through the blur");
    const photo = page.locator('[data-part="photo-well"]');
    await page.setInputFiles('[data-part="photo-well"] input[type="file"]', {
      name: "kit.png",
      mimeType: "image/png",
      buffer: PNG_1X1,
    });
    await expect(photo).toHaveAttribute("data-state", "filled", {
      timeout: 20_000,
    });

    await page.getByRole("button", { name: "Next — did it work?" }).click();
    await page.waitForURL("**/feed/verdict/**");
    await hydrated(page);

    // ---- A3 · the receipt, even when nothing moved -------------------
    await scene(page, "A3 · log it — the receipt says why nothing moved");
    await page.getByRole("button", { name: "Dialed" }).click();
    await page.getByRole("button", { name: "Log it" }).click();
    const noted = page.locator('[data-slot="noted"]');
    await expect(noted).toBeVisible({ timeout: 15_000 });
    await expect(noted).toContainText("Logged.");
    await expect(page).toHaveURL(/\/feed\/verdict\//u);

    // ---- R1 · by hand, straight on to the outfit ---------------------
    await page.setViewportSize(DESK);
    await scene(page, "By hand: the run, then straight on to what you wore");
    await page.goto("/runs/manual");
    await hydrated(page);
    await page.getByLabel("Title").fill("Demo tempo run");
    await page.getByLabel("Started").fill("2026-09-06T07:15");
    await page.getByLabel("Minutes").fill("32");
    await page.getByLabel("Distance (km)").fill("6.5");
    await page.getByRole("button", { name: "Next · pick the outfit" }).click();
    await page.waitForURL("**/feed/attach/**");
    await hydrated(page);
    await expect(
      page.getByRole("heading", { name: "What did you wear?" }),
    ).toBeVisible();

    // ---- R · the list, and R2b ---------------------------------------
    await scene(page, "Runs · four badges and one breath");
    await page.goto("/runs");
    await hydrated(page);
    await expect(page.locator('[data-slot="run-row"]').first()).toBeVisible();

    await scene(page, "No weather came back — set it by picking, never typing");
    const stale = page.locator('[data-slot="run-row"]').filter({
      has: page.locator(`a[href="/runs/${staleRunId}"]`),
    });
    await expect(stale).toContainText("No weather for this time");
    await stale.getByRole("button", { name: /Set conditions/u }).click();
    const sheet = page.getByRole("dialog", { name: "No weather saved" });
    await expect(sheet).toBeVisible();
    await sheet
      .getByRole("button", { name: "Set conditions", exact: true })
      .click();
    await expect(sheet.locator("input")).toHaveCount(0);
    // The band for 10–15 °C, in whichever unit the runner reads.
    await sheet.locator("fieldset button").nth(6).click();
    await expect(sheet).toBeHidden({ timeout: 15_000 });
    await expect(stale).toContainText(/· set by you/u, { timeout: 15_000 });

    // ---- The import page is gone --------------------------------------
    await scene(page, "The old import page is gone — its URL lands on A1");
    await page.goto(`/runs/import/${newUlid()}`);
    await hydrated(page);
    await expect(page).toHaveURL(/\/runs\/new$/u);
  } finally {
    await unseed(seeded);
  }
});
