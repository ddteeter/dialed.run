import { eq, sql } from "drizzle-orm";
import { expect, test } from "@playwright/test";
import type { Page } from "@playwright/test";

import { userProfiles } from "../../src/db/schema-core";
import { nowSeconds } from "../../src/lib/now";
import { storageStateFor } from "../support/accounts";
import { PHONE } from "../support/bars";
import { cellsOf, openBoard, part, screen } from "../support/conformance";
import { withLocalDb } from "../support/local-db";
import {
  feedUserId,
  fillOf,
  folded,
  holdForever,
  hydrated,
  removeSeeded,
  seedEntry,
  seeded,
  seedObservation,
  seedRunner,
  unfollowEveryone,
} from "./feed-support";

/**
 * E2-lite, Your conditions — round 22's four drawn states: "Waiting",
 * "Location denied", "No matches", "Widened window".
 *
 * The block's copy is compared word for word where it is copy. Where it is
 * data — the band in the eyebrow, how many runners — both sides are read
 * against the same shape, so a drift in the *format* ("LAST 3 DAYS" where
 * the board says the slot is always there) still fails.
 *
 * The runner signs in with no follows and no saved place, so the tab opens
 * on its own and asks the browser, which each test answers.
 */
test.use({ storageState: storageStateFor("feed") });

const BOARD = "Round 22 Coverage.dc.html";
/**
 * Round 25's eyebrow: "same conditions, wherever they were" (owner,
 * 2026-09-24). The round-25 import redrew the round 22 board to it, so the
 * drawing and the build are held to the one template.
 */
const EYEBROW =
  /^SAME CONDITIONS · FEELS \[ ?\d+–\d+° ?\] · (DRY|DAMP|RAIN)( · 14 DAYS)?$/u;
/**
What the line says was matched, as the harness reads it (upper-cased).
*/
const CONDITIONS = String.raw`\d+° AND (DRY|DAMP|RAIN)`;

/**
Where these specs stand: places nothing else in the suite seeds.
*/
const HERE = { lat: 23.45, lng: 67.89 };
const DAY = 24 * 3600;

async function freshRunner(): Promise<void> {
  const userId = await feedUserId();
  await unfollowEveryone(userId);
  // No saved place and no typed city, so the tab asks the browser.
  await withLocalDb(({ core }) =>
    core
      .update(userProfiles)
      .set({ cityLabel: sql`NULL`, lat: sql`NULL`, lng: sql`NULL` })
      .where(eq(userProfiles.userId, userId)),
  );
}

async function openConditions(page: Page): Promise<void> {
  await page.setViewportSize(PHONE);
  await page.goto("/feed");
  await hydrated(page);
  await expect(
    page.getByRole("button", { name: "Your conditions" }),
  ).toHaveAttribute("aria-current", "page");
}

async function drawnBlock(
  page: Page,
  baseURL: string,
  label: string,
): Promise<readonly string[]> {
  await openBoard(page, BOARD, baseURL);
  const cells = await cellsOf(page, part(label, "match-block"));
  expect(cells, `the board has no ${label} match block`).not.toHaveLength(0);
  return cells;
}

test.describe("with the location granted", () => {
  test.use({
    geolocation: { latitude: HERE.lat, longitude: HERE.lng },
    permissions: ["geolocation"],
  });

  test("E2-lite waiting is the one breathing headline the board draws", async ({
    page,
    baseURL,
  }) => {
    if (baseURL === undefined) throw new Error("no baseURL");
    const drawn = await drawnBlock(page, baseURL, "E2-lite Waiting");

    await freshRunner();
    // Hold every server call, so the tab stays asking-and-fetching.
    await page.route("**/_serverFn/**", holdForever);
    await openConditions(page);

    const built = '[data-part="match-block"][data-state="waiting"]';
    await page.locator(built).waitFor();
    expect(await cellsOf(page, built)).toEqual(drawn);
    await expect(page.locator(built)).toHaveAttribute("aria-busy", "true");
    await expect(page.locator(`${built} .breathe`)).toHaveCount(2);
  });

  test("E2-lite no matches is the privacy floor, said the board's way", async ({
    page,
    baseURL,
  }) => {
    if (baseURL === undefined) throw new Error("no baseURL");
    const drawn = await drawnBlock(page, baseURL, "E2-lite No matches");
    const drawnBody = await cellsOf(
      page,
      `${part("E2-lite No matches", "match-block")} + div`,
    );

    await freshRunner();
    const rows = seeded();
    // A reading here and now, in a band nothing else in the suite logs.
    await seedObservation(rows, HERE, nowSeconds(), { feelsLikeC: 33 });
    try {
      await openConditions(page);

      const built = '[data-part="match-block"][data-state="no-matches"]';
      await page.locator(built).waitFor();
      const cells = await cellsOf(page, built);
      // The eyebrow is data; its shape is not. The headline is copy.
      expect(drawn[0]).toMatch(EYEBROW);
      expect(cells[0]).toMatch(EYEBROW);
      expect(cells.slice(1)).toEqual(drawn.slice(1));
      // Round 25's line; the rest of the body is still the board's.
      const body = folded(await cellsOf(page, `${built} + div`));
      expect(body[0]).toMatch(
        new RegExp(
          String.raw`^FEWER THAN FIVE RUNNERS LOGGED ${CONDITIONS} IN TWO WEEKS, WHICH IS TOO FEW TO SHOW WITHOUT SHOWING WHO\.$`,
          "u",
        ),
      );
      expect(body.slice(1)).toEqual(folded(drawnBody).slice(1));
      // Teal means matched, so an empty answer sits on the paper.
      expect(await fillOf(page, built)).toBe("transparent");
    } finally {
      await removeSeeded(rows);
    }
  });

  test("E2-lite widened says fourteen days, in the teal that means matched", async ({
    page,
    baseURL,
  }) => {
    if (baseURL === undefined) throw new Error("no baseURL");
    const label = "E2-lite Widened window";
    const drawn = await drawnBlock(page, baseURL, label);
    const drawnFill = await fillOf(page, part(label, "match-block"));
    const drawnList = await cellsOf(
      page,
      `${part(label, "match-block")} + div`,
    );

    await freshRunner();
    const rows = seeded();
    const now = nowSeconds();
    const there = { lat: 23.46, lng: 67.89 };
    await seedObservation(rows, there, now, { feelsLikeC: 40 });
    await page.context().setGeolocation({
      latitude: there.lat,
      longitude: there.lng,
    });
    // Five runners, all more than three days back and inside fourteen:
    // under the floor for three days, over it for fourteen.
    for (let index = 0; index < 5; index += 1) {
      const runner = await seedRunner(rows, `E2 runner ${String(index)}`);
      await seedEntry(rows, {
        userId: runner,
        // Whole hundredths, as the cache rounds them: 24.01 + 0.01 is not 24.02.
        place: { lat: (2401 + index) / 100, lng: 68.01 },
        startedAt: now - (5 + index) * DAY,
        feelsLikeC: 40,
        verdict: 0,
      });
    }

    try {
      await openConditions(page);

      const built = '[data-part="match-block"][data-state="widened"]';
      await page.locator(built).waitFor();
      const cells = await cellsOf(page, built);
      expect(cells).toHaveLength(drawn.length);
      expect(drawn[0]).toMatch(EYEBROW);
      expect(cells[0]).toMatch(EYEBROW);
      expect(drawn[1]).toMatch(/^\d+ RUNNERS LOGGED THIS$/u);
      // At least the five seeded here: a local database can hold runs
      // from an earlier, interrupted spec in the same band.
      expect(cells[1]).toMatch(/^\d+ RUNNERS LOGGED THIS$/u);
      expect(Number(cells[1]?.split(" ", 1)[0])).toBeGreaterThanOrEqual(5);
      expect(cells[2]).toMatch(
        new RegExp(
          String.raw`^IN ${CONDITIONS}, WHEREVER THEY WERE\. TOO FEW IN THREE DAYS, SO THIS LOOKS BACK TWO WEEKS\.$`,
          "u",
        ),
      );
      expect(await fillOf(page, built)).toBe(drawnFill);
      // What they wore, headed as drawn. The rows are this aggregate's.
      const list = await cellsOf(page, `${built} + div`);
      expect(list[0]).toBe(drawnList[0]);
    } finally {
      await removeSeeded(rows);
    }
  });
});

test.describe("with the location refused", () => {
  test.use({ permissions: [] });

  test("E2-lite location denied asks where they run, as drawn", async ({
    page,
    baseURL,
  }) => {
    if (baseURL === undefined) throw new Error("no baseURL");
    const label = "E2-lite Location denied";
    await openBoard(page, BOARD, baseURL);
    const drawn = await cellsOf(page, part(label, "match-block"));
    const drawnPrimary = await fillOf(page, part(label, "primary-action"));
    expect(drawn, "the board has no location-denied block").not.toHaveLength(0);
    await expect(page.locator(screen(label))).toHaveCount(1);

    await freshRunner();
    await page.context().clearPermissions();
    await openConditions(page);

    const built = '[data-part="match-block"][data-state="location-denied"]';
    await page.locator(built).waitFor();
    const cells = folded(await cellsOf(page, built));
    // Eyebrow, headline and lead are copy, word for word.
    expect(cells.slice(0, 3)).toEqual(folded(drawn.slice(0, 3)));
    // The field is O1's "City"; the board's "Portland, OR" is a
    // placeholder a runner never sees typed. The hint under it asks for
    // the state too (PR #102 review): placeholder copy pending design, so
    // the board does not draw it.
    expect(cells[3]).toBe("CITY CITY AND STATE, E.G. PORTLAND, OR");
    expect(drawn[3]).toMatch(/^CITY /u);
    // The primary says what the board's does, and the line under it too.
    expect(cells.at(-1)).toBe(drawn.at(-1));
    expect(cells).toContain(`USE THIS CITY [ SAVING ]`);
    expect(drawn).toContain("USE THIS CITY");
    // Not a failure: no band, nothing yellow.
    await expect(
      page.locator(`${built} [data-part="failure-band"]`),
    ).toHaveCount(0);
    expect(drawnPrimary).not.toBe("--failure");
  });
});
