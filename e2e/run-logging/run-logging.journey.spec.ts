/**
 * Covers: A1 (upload, read in place — the parsed card, no import page;
 * at the desk in two columns with the conditions in the rail; the start-time
 * correction, round 26 item 1), A2 (the picker from the first frame, a kit
 * required, the outfit photo through W3's blur, and at the desk the rail's
 * band history, round 25, and A2b's push into the column, Round 54 ·
 * 164.3), S1 (the Strava reminder a matching upload
 * clears, round 25), A3 (Noted, with the band the corrected run now has,
 * and the desk rail's band history), R1 (manual entry going on to the
 * outfit, R-102) and R (the runs list's badges).
 *
 * Journey: open the closet -> launch the log flow from the bar -> drop a
 * GPX file and watch it read in place -> A2: try Next with nothing chosen,
 * pick a piece on A2b's pushed page, add a photo -> A3: log it and read the receipt -> enter a
 * run by hand and land on picking its outfit -> the runs list.
 * `run-logging.spec.ts` holds R2b's conditions by picking, deleting a run,
 * the retired import URL, and the Garmin TCX reads (R-130, D-111).
 *
 * **It opens on the closet rather than on `/runs/new`, and that is the
 * point of the first beat** (task 117). A `page.goto` is a document load,
 * which is a first paint — NAV types it `cut`, so a demo that jumps
 * straight to a screen records none of the move that gets it there. Going
 * in through the bar records two things at once: the `rise` that lays the
 * flow over where the runner was, and R-80's other half — the Closet tab
 * stays lit underneath, because `+ Add` is a launcher and not a tab.
 *
 * Exactly one test() per journey spec. A second test here would record a
 * second video beside the one the reviewer is meant to watch; standalone
 * assertions belong in a sibling *.spec.ts.
 *
 * Deliberately excluded: Strava OAuth (no credentials, and the connect flow
 * redirects off-app so it can't be recorded).
 */
import { eq } from "drizzle-orm";

import { notifications } from "../../src/db/schema-core";
import { clockLabel, timeOfDay } from "../../src/lib/dates";
import { newUlid } from "../../src/lib/ids";
import { nowSeconds } from "../../src/lib/now";
import {
  gpx,
  hydrated,
  seedItem,
  seedObservation,
  unseed,
  unseedObservations,
  userIdOf,
} from "../conformance/logging-fixtures";
import type { Seeded } from "../conformance/logging-fixtures";
import { storageStateFor } from "../support/accounts";
import { DESK, PHONE, bar, launcher } from "../support/bars";
import { expect, scene, test } from "../support/demo";
import { withLocalDb } from "../support/local-db";

// Signed in already: the account is created by the `demo-setup` project, so
// this video opens on logging a run rather than on a signup form.
test.use({
  storageState: storageStateFor("run-logging"),
  // A1 reads a run with no conditions yet on the device's clock; pinned so
  // the times the demo types and reads are the ones the card shows.
  timezoneId: "America/Chicago",
});

/**
 * A real 1x1 PNG — a decodable image rather than bytes with an image/png
 * label, because the blur step decodes what it is given.
 */
const PNG_1X1 = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
  "base64",
);

/**
 * A start as the parsed card reads it, and as its time input takes it: on
 * Chicago's clock, the zone the seeded observations name — through the
 * app's own formatters, so the demo and the card cannot disagree.
 */
const CHICAGO = "America/Chicago";

function clockOf(epochSeconds: number): string {
  return clockLabel(epochSeconds, CHICAGO);
}

/**
 * "Now" for this journey. `DEMO_CLOCK_UTC=HH:MM` pins it to the most recent
 * instant at that UTC time of day, so an hour-dependent failure can be
 * reproduced on demand rather than waited for.
 */
function demoNow(): number {
  const real = nowSeconds();
  const pin = /^(?<h>\d{2}):(?<m>\d{2})$/u.exec(
    process.env.DEMO_CLOCK_UTC ?? "",
  );
  if (pin?.groups === undefined) return real;
  const offset = Number(pin.groups.h) * 3600 + Number(pin.groups.m) * 60;
  const today = Math.floor(real / 86_400) * 86_400 + offset;
  return today <= real ? today : today - 86_400;
}

function hhmmOf(epochSeconds: number): string {
  return timeOfDay(epochSeconds, CHICAGO);
}

test("log a run: read a file in place, pick the kit, note it, enter one by hand", async ({
  page,
}, testInfo) => {
  // Generous, because recording pace is not a latency budget. `scene()`
  // holds a beat at each boundary and slowMo paces the actions between
  // them (R-58), so a recorded run takes minutes where CI's takes seconds.
  testInfo.setTimeout(180_000);

  // A piece to wear — seeded, because the closet is another journey's
  // business. The conformance fixtures' own seeding and clean-up, so this journey and
  // the specs that share its account take out the same rows.
  const seeded: Seeded = {
    userId: await userIdOf("run-logging"),
    runIds: [],
    itemIds: [],
    entryIds: [],
  };
  await seedItem(seeded, "Demo half-zip", "top");
  // The file's start, and the two corrections A1 is shown: an hour with a
  // seeded observation, and one with none (no provider key locally, so it
  // is refused, which is the point of the beat). The file's own hour is
  // seeded too, so its conditions land in the consumer's pass.
  //
  // All three on one Chicago day. A correction moves the time and never
  // the date (round 26, #1), so "00:04" typed against an 11:04 PM start
  // means 00:04 that same morning, 23 hours earlier — not the hour after.
  // Five hours back from 09:0x UTC lands on 11:04 PM CDT, and the demo
  // failed there. So a start later than 9:04 PM steps back until both
  // corrections still fall before midnight.
  const latestStart = (Math.floor(demoNow() / 3600) - 5) * 3600 + 4 * 60;
  const hoursPastNine = Number(hhmmOf(latestStart).slice(0, 2)) - 21;
  const fileStart = latestStart - Math.max(0, hoursPastNine) * 3600;
  const movedStart = fileStart + 3600;
  const noWeatherStart = fileStart + 2 * 3600;
  const observations = [
    await seedObservation(Math.floor(fileStart / 3600), {
      tempC: 2,
      precipMm: 0,
    }),
    await seedObservation(Math.floor(movedStart / 3600), {
      tempC: 8,
      precipMm: 0,
    }),
  ];
  // The Strava reminder this file answers (round 25): landed on Strava
  // half an hour after the run ended. Seeded as the consumer writes it;
  // the webhook itself needs a Strava subscription no local stack has.
  const reminderId = newUlid();
  await withLocalDb(async ({ core }) => {
    await core.insert(notifications).values({
      id: reminderId,
      userId: seeded.userId,
      kind: "strava_reminder",
      subjectId: newUlid(),
      body: "New run on Strava · Add it here: upload the file, then what you wore",
      createdAt: fileStart + 5 * 60 + 1800,
    });
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
    // Round 52 #161: a button that navigates, promising no dialog.
    await expect(launcher(page)).not.toHaveAttribute("aria-haspopup");
    await expect(bar(page).locator('[aria-current="page"]')).toHaveCount(0);

    // ---- A1 · the file reads in place --------------------------------
    await scene(page, "A1 · drop a file — it reads here, nothing navigates");
    const well = page.locator('[data-part="drop-zone"]');
    await page.setInputFiles('[data-part="drop-zone"] input[type="file"]', {
      name: "morning_run.gpx",
      mimeType: "application/gpx+xml",
      // Hours ago, so it never reads as a run already logged.
      buffer: gpx(fileStart, 6),
    });
    await expect(well).toHaveAttribute("data-state", "uploading");
    await expect(page).toHaveURL(/\/runs\/new$/u);

    await scene(page, "The parsed card lands where the drop zone was");
    await expect(page.getByText("Parsed · morning_run.gpx")).toBeVisible({
      timeout: 20_000,
    });
    await expect(page).toHaveURL(/\/runs\/new$/u);

    // ---- A1 at the desk · two columns, and the start-time correction --
    await page.setViewportSize(DESK);
    await scene(
      page,
      "A1 at the desk · the card in the column, weather in the rail",
    );
    const card = page.locator('[data-slot="parsed-card"]');
    const rail = page.locator('[data-part="rail"]');
    const cardBox = await card.boundingBox();
    const railBox = await rail.boundingBox();
    expect(railBox?.x ?? 0).toBeGreaterThan(
      (cardBox?.x ?? 0) + (cardBox?.width ?? 0),
    );
    await expect(rail.locator("input, button, [role='radio']")).toHaveCount(0);
    await scene(page, "Its conditions land with it, not an hour later");
    const conditions = page.locator('[data-slot="conditions"]');
    await expect(conditions).toContainText("36°F", { timeout: 20_000 });

    await scene(
      page,
      "Wrong start time? Change it, and get the weather for it",
    );
    await page
      .getByRole("button", { name: `${clockOf(fileStart)}, change start time` })
      .click();
    const startField = page.getByLabel("Start time");
    await expect(startField).toBeFocused();
    await startField.fill(hhmmOf(noWeatherStart));
    await page.getByRole("button", { name: "Get weather" }).click();
    await scene(
      page,
      "No weather for that hour — the time and conditions go back",
    );
    // The band holds Try again, so it is in the primary column, not the rail.
    const still = page.locator('[data-part="failure-band"]');
    await expect(rail.locator('[data-part="failure-band"]')).toHaveCount(0);
    await expect(still).toContainText(`Still ${clockOf(fileStart)}`, {
      timeout: 20_000,
    });
    await expect(still).toContainText(
      `Couldn't get weather for ${clockOf(noWeatherStart)}. Try again?`,
    );
    await expect(conditions).toContainText("36°F");

    await startField.fill(hhmmOf(movedStart));
    await page.getByRole("button", { name: "Get weather" }).click();
    await scene(page, "A time with weather: the row closes and says CHANGED");
    await expect(
      page.getByRole("button", {
        name: `${clockOf(movedStart)} · Changed, change start time`,
      }),
    ).toContainText("Changed", { timeout: 20_000 });
    await expect(conditions).toContainText("46°F", { timeout: 20_000 });
    await page.getByRole("link", { name: "What did you wear?" }).click();
    await hydrated(page);

    // ---- A2 · the kit, required, and the photo -----------------------
    await scene(page, "A2 · the picker is here from the first frame");
    // DS1b: the bell is on every screen, A2 included (R-102).
    await expect(
      page.getByRole("link", { name: /^Notifications\b/u }).first(),
    ).toBeVisible();
    // The drawn line; its said twin is visually hidden (round 52 #158).
    await expect(page.getByText(/· 0 pieces/u)).toBeVisible();
    // Round 25's A2 rail at the desk: the run, then the band history behind
    // MOST LIKELY, fetched once the screen is drawn. This runner has none
    // in the band yet, so the heading names the band over DS2's words
    // (round 47 #118).
    await scene(page, "A2 at the desk · the band history in the rail");
    const kitRail = page.locator('[data-part="rail"]');
    await expect(
      kitRail.getByRole("heading", {
        name: /^In (minus )?\d+ to (minus )?\d+ degrees, (dry|damp|wet)$/u,
      }),
    ).toBeVisible({ timeout: 15_000 });
    await expect(kitRail).toContainText("No runs in this band yet.");
    await scene(page, "A kit is required — the button never relabels");
    await page.getByRole("button", { name: "Next — did it work?" }).click();
    await expect(page.getByText("Pick at least one piece.")).toBeVisible();

    // At the desk a category is a push into the column, not a sheet
    // (Round 54 · 164.3): the URL changes, and Done comes back to A2 with
    // the pick made there.
    await scene(page, "A2b at the desk · a push, with the picks kept");
    await page.getByRole("button", { name: "All Tops" }).click();
    await page.waitForURL(/[?&]pick=tops\b/u);
    await expect(
      page.getByRole("heading", { name: "Tops", level: 1 }),
    ).toBeVisible();
    await expect(page.getByRole("dialog")).toHaveCount(0);
    await page.getByRole("checkbox", { name: "Demo half-zip" }).check();
    await page.getByRole("button", { name: "Done" }).click();
    await expect(page).not.toHaveURL(/[?&]pick=/u);
    await expect(
      page.getByRole("button", { name: "Demo half-zip" }),
    ).toHaveAttribute("aria-pressed", "true");
    await expect(page.getByText(/· 1 piece$/u)).toBeVisible();
    await expect(page.getByText("Pick at least one piece.")).toHaveCount(0);

    await scene(page, "The outfit photo lives here now, through the blur");
    const photo = page.locator('[data-part="photo-well"]');
    await page.setInputFiles('[data-part="photo-well"] input[type="file"]', {
      name: "kit.png",
      mimeType: "image/png",
      buffer: PNG_1X1,
    });
    // W3 waits for the runner (round 28 #5): nothing is attached until
    // Use this photo, which waits behind aria-disabled while it blurs. It
    // is a sheet over A2, named for its head, as the closet's is.
    const blurSheet = page.getByRole("dialog", { name: "Check the blur" });
    await expect(blurSheet).toBeVisible({ timeout: 20_000 });
    await blurSheet
      .getByRole("button", { name: "Use this photo" })
      .click({ timeout: 20_000 });
    await expect(blurSheet).toBeHidden();
    await expect(photo).toHaveAttribute("data-state", "filled", {
      timeout: 20_000,
    });

    await page.getByRole("button", { name: "Next — did it work?" }).click();
    await page.waitForURL("**/feed/verdict/**");
    await hydrated(page);

    // ---- A3 · the receipt, even when nothing moved -------------------
    await scene(page, "A3 · log it — the receipt counts the piece in its band");
    // And on A3 (R-102).
    await expect(
      page.getByRole("link", { name: /^Notifications\b/u }).first(),
    ).toBeVisible();
    // Round 25's A3 rail: the kit being judged, with no record line for a
    // piece never worn in the band before (round 47 #119), over the same
    // band history as A2.
    const verdictRail = page.locator('[data-part="rail"]');
    await expect(
      verdictRail.getByRole("heading", {
        name: /^Before, in (minus )?\d+ to (minus )?\d+ degrees, (dry|damp|wet)$/u,
      }),
    ).toBeVisible();
    await expect(verdictRail).toContainText("No runs in this band yet.");
    await expect(verdictRail).not.toContainText("dialed ·");
    await page.getByRole("radio", { name: "Dialed", exact: true }).click();
    await page.getByRole("button", { name: "Log it" }).click();
    const noted = page.locator('[data-slot="noted"]');
    await expect(noted).toBeVisible({ timeout: 15_000 });
    await expect(noted).toContainText("Demo half-zip is now 1 of 1");
    await expect(page).toHaveURL(/\/feed\/verdict\//u);

    // ---- S1 · the upload answered Strava's reminder -------------------
    await scene(
      page,
      "The Strava reminder for this run cleared when its file came in",
    );
    await page.goto("/notifications");
    await hydrated(page);
    const reminder = page
      .getByRole("listitem")
      .filter({ hasText: "New run on Strava · Add it here" });
    await expect(reminder).toHaveCount(1);
    // Read: the paper and quiet text, where unread is a white row.
    await expect(reminder).toHaveClass(/text-quiet/u);
    await expect(reminder).not.toHaveClass(/bg-panel/u);

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

    // ---- R · the list ------------------------------------------------
    await scene(
      page,
      "Runs · month breaks, one line a row, marks at the right",
    );
    await page.goto("/runs");
    await hydrated(page);
    await expect(page.locator('[data-slot="run-row"]').first()).toBeVisible();
    // FEED-3: the runs pages' bell counts the runs still owed a verdict,
    // where it used to show only a dot.
    await expect(
      page
        .getByRole("link", { name: /^Notifications, (\d+|more than 9) new$/u })
        .first(),
    ).toHaveAttribute("data-state", "number");
  } finally {
    await unseed(seeded);
    await unseedObservations(observations);
    await withLocalDb(async ({ core }) => {
      await core.delete(notifications).where(eq(notifications.id, reminderId));
    });
  }
});
