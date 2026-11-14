import type { Page, Route } from "@playwright/test";
import { expect, test } from "../support/a11y";

import { PNG_1X1 } from "../closet/closet-support";
import { storageStateFor } from "../support/accounts";
import { isServerFnCall } from "../support/server-fn";
import {
  colorRole,
  openBoard,
  part,
  signatureOf,
} from "../support/conformance";
import type { Seeded } from "./logging-fixtures";
import {
  BOARD_MORNING,
  hydrated,
  lookOf,
  seedEntry,
  seedItem,
  seedObservation,
  seedRun,
  unseed,
  unseedObservations,
  userIdOf,
} from "./logging-fixtures";

/**
 * A2 before a suggestion, against round 22's two frames: "A2 Waiting" —
 * only most-likely waits, the rest is A2 at rest from the first frame —
 * and "A2 No suggestion", one line and no card.
 *
 * Compared by region: the header's sub-line, most-likely, and the
 * primary. The closet picker is compared by its heading only: the board
 * draws it unfiltered while waiting because its band had not arrived,
 * where ours knows the run's band from the first frame (the run's own
 * conditions come with the route), so the filter is already on — a
 * difference recorded in the PR's design deltas rather than hidden here.
 */
test.use({ storageState: storageStateFor("run-logging") });

const ROUND_22 = "Round 22 Coverage.dc.html";

/**
 * The server function A2 waits on, by name (`support/server-fn`).
 */
function isPrefill(url: string): boolean {
  return isServerFnCall(url, "prefillForRun");
}

/**
Holds the suggestion forever — "A2 Waiting" — and lets everything else by.
*/
async function holdTheSuggestion(page: Page): Promise<void> {
  await page.route("**/_serverFn/**", async (route: Route) => {
    if (isPrefill(route.request().url())) return;
    await route.continue();
  });
}

/**
Apostrophes as typed, so a board's `'` and our `’` compare as one.
*/
function plain(rows: readonly (readonly string[])[]): string[][] {
  return rows.map((row) => row.map((cell) => cell.replaceAll("’", "'")));
}

const MOST_LIKELY = '[data-slot="most-likely"]';

test.describe("A2 · before a suggestion", () => {
  let seeded: Seeded;
  let runId: string;

  test.beforeEach(async () => {
    seeded = {
      userId: await userIdOf("run-logging"),
      runIds: [],
      itemIds: [],
      entryIds: [],
    };
    await unseed(seeded);
    runId = await seedRun(seeded, {
      observed: true,
      weatherStatus: "attached",
    });
    await seedItem(seeded, "Conformance top", "top");
    await seedItem(seeded, "Conformance tights", "bottom");
  });

  test.afterEach(async () => {
    await unseed(seeded);
  });

  test("waiting: only most-likely waits, in the board's words and frame", async ({
    page,
    baseURL,
  }) => {
    if (baseURL === undefined) throw new Error("no baseURL");
    const label = "A2 Waiting";
    await openBoard(page, ROUND_22, baseURL);
    const drawnHeader = await signatureOf(page, part(label, "header"));
    const drawnWaiting = await signatureOf(page, part(label, "most-likely"));
    const drawnWaitingLook = await lookOf(page, part(label, "most-likely"));
    const drawnPrimary = await signatureOf(page, part(label, "primary-action"));
    const drawnPrimaryLook = await lookOf(page, part(label, "primary-action"));
    const drawnPicker = await signatureOf(page, part(label, "closet-picker"));
    expect(drawnWaiting, "the board has no waiting region").not.toHaveLength(0);

    await holdTheSuggestion(page);
    await page.setViewportSize({ width: 390, height: 900 });
    await page.goto(`/feed/attach/${runId}`);
    await hydrated(page);

    // The header's sub-line: "6.2 MI · 41°F DAMP · 0 PIECES", and under it
    // Visual Crossing's credit, which closes the header. The sub-line is
    // the provider's reading and the licence asks for the credit near it
    // (D-144); round 22 predates that, so the credit is a recorded
    // deviation beyond the board (docs/design-deltas.md #67, "A2's
    // header"). The sub-line above it is still the board's.
    const header = await signatureOf(page, '[data-slot="header"]');
    expect(header.at(-1)).toEqual(["WEATHER DATA PROVIDED BY VISUAL CROSSING"]);
    expect(header.at(-2)).toEqual(drawnHeader.at(-1));

    const waiting = page.locator(MOST_LIKELY);
    await expect(waiting).toHaveAttribute("data-state", "waiting");
    await expect(waiting).toHaveAttribute("aria-busy", "true");
    expect(await signatureOf(page, MOST_LIKELY)).toEqual(drawnWaiting);
    const look = await lookOf(page, MOST_LIKELY);
    expect(colorRole(look.fill)).toBe(colorRole(drawnWaitingLook.fill));
    expect(look.borderStyle).toBe(drawnWaitingLook.borderStyle);
    expect(colorRole(look.borderColor)).toBe(
      colorRole(drawnWaitingLook.borderColor),
    );

    // The picker and the primary are there from the first frame.
    const picker = await signatureOf(page, '[data-slot="closet-picker"]');
    expect(picker[0]?.[0]).toBe(drawnPicker[0]?.[0]);
    expect(await signatureOf(page, '[data-slot="primary-action"]')).toEqual(
      drawnPrimary,
    );
    const primary = await lookOf(page, '[data-slot="primary-action"]');
    expect(colorRole(primary.fill)).toBe(colorRole(drawnPrimaryLook.fill));
  });

  test("no suggestion: one line, no card, and the picker loses its OR", async ({
    page,
    baseURL,
  }) => {
    if (baseURL === undefined) throw new Error("no baseURL");
    const label = "A2 No suggestion";
    await openBoard(page, ROUND_22, baseURL);
    const drawnNone = await signatureOf(page, part(label, "most-likely"));
    const drawnNoneLook = await lookOf(page, part(label, "most-likely"));
    const drawnPicker = await signatureOf(page, part(label, "closet-picker"));
    expect(drawnNone, "the board has no no-suggestion region").not.toHaveLength(
      0,
    );

    await page.setViewportSize({ width: 390, height: 900 });
    await page.goto(`/feed/attach/${runId}`);
    await hydrated(page);

    const none = page.locator(MOST_LIKELY);
    await expect(none).toHaveAttribute("data-state", "none", {
      timeout: 15_000,
    });
    expect(plain(await signatureOf(page, MOST_LIKELY))).toEqual(
      plain(drawnNone),
    );
    const look = await lookOf(page, MOST_LIKELY);
    expect(colorRole(look.fill)).toBe(colorRole(drawnNoneLook.fill));
    // "One line, no card": no box around it, a rule beneath.
    expect(look.borderStyle).toBe(drawnNoneLook.borderStyle);
    expect(look.ruleBelow).toBe(drawnNoneLook.ruleBelow);

    const picker = await signatureOf(page, '[data-slot="closet-picker"]');
    expect(picker[0]?.[0]).toBe(drawnPicker[0]?.[0]);
  });
});

/**
 * Two states no board is compared with here. Each ends at the phone's
 * width so what a screen reader says on it is checked in (#582): the
 * suggestion offered, and a category's sheet open over the picker.
 */
test.describe("A2 · heard at 390", () => {
  let seeded: Seeded;
  let runId: string;
  let observations: string[] = [];

  test.beforeEach(async ({ page }) => {
    seeded = {
      userId: await userIdOf("run-logging"),
      runIds: [],
      itemIds: [],
      entryIds: [],
    };
    await unseed(seeded);
    runId = await seedRun(seeded, {
      observed: true,
      weatherStatus: "attached",
    });
    await seedItem(seeded, "Conformance top", "top");
    await seedItem(seeded, "Conformance tights", "bottom");
    await page.setViewportSize({ width: 390, height: 900 });
  });

  test.afterEach(async () => {
    await unseed(seeded);
    await unseedObservations(observations);
    observations = [];
  });

  test("a suggestion: the kit worn last time it was like this, and That's it", async ({
    page,
  }) => {
    // The same kit a week before, in the same weather as this run's.
    const lastWeek = BOARD_MORNING - 7 * 86_400;
    observations = [
      await seedObservation(Math.floor(lastWeek / 3600), {
        tempC: 5,
        precipMm: 1,
      }),
    ];
    const worn = await seedRun(seeded, {
      observed: false,
      weatherStatus: "attached",
      startedAt: lastWeek,
    });
    await seedEntry(seeded, worn, seeded.itemIds);

    await page.goto(`/feed/attach/${runId}`);
    await hydrated(page);

    await expect(page.locator(MOST_LIKELY)).toHaveAttribute(
      "data-state",
      "suggestion",
      { timeout: 15_000 },
    );
    await expect(page.getByRole("button", { name: "That’s it" })).toBeVisible();
  });

  test("A2b: a category's sheet, open over the picker", async ({ page }) => {
    await page.goto(`/feed/attach/${runId}`);
    await hydrated(page);

    await page.getByRole("button", { name: "All Tops" }).click();
    const sheet = page.getByRole("dialog", { name: "Tops" });
    await expect(sheet).toBeVisible();
    await expect(
      sheet.getByRole("checkbox", { name: /^Conformance top/u }),
    ).toBeVisible();
  });
});

/**
 * The full photo (Round 56 · 249.1), the only check that sees the real
 * dialog in the top layer: from 720 the centred panel at MEASURE.column
 * over the scrim, and on a phone the whole screen. One photo, so no
 * arrows; paging is the dom tests'. It ends open at 390, so what a
 * screen reader says on it is checked in.
 */
test.describe("A2 · the full photo", () => {
  let seeded: Seeded;
  let runId: string;

  test.beforeEach(async () => {
    seeded = {
      userId: await userIdOf("run-logging"),
      runIds: [],
      itemIds: [],
      entryIds: [],
    };
    await unseed(seeded);
    runId = await seedRun(seeded, {
      observed: true,
      weatherStatus: "attached",
    });
    await seedItem(seeded, "Conformance top", "top");
  });

  test.afterEach(async () => {
    await unseed(seeded);
  });

  test("a centred panel from 720, the whole screen on a phone", async ({
    page,
  }) => {
    await page.setViewportSize({ width: 1280, height: 900 });
    await page.goto(`/feed/attach/${runId}`);
    await hydrated(page);

    await page.setInputFiles('[data-part="add-photo"] input[type="file"]', {
      name: "kit.png",
      mimeType: "image/png",
      buffer: PNG_1X1,
    });
    const blurSheet = page.getByRole("dialog", { name: "Check the blur" });
    await expect(blurSheet).toBeVisible({ timeout: 20_000 });
    await blurSheet
      .getByRole("button", { name: "Use this photo" })
      .click({ timeout: 20_000 });
    await expect(blurSheet).toBeHidden();

    const thumbnail = page.getByRole("button", { name: "Photo 1 of 1" });
    await expect(thumbnail).toBeVisible({ timeout: 20_000 });
    const thumb = await thumbnail.boundingBox();
    // 249.4: 76 × 95.
    expect(thumb?.width).toBe(76);
    expect(thumb?.height).toBe(95);

    await thumbnail.click();
    const viewer = page.getByRole("dialog", { name: "Photo 1 of 1" });
    await expect(viewer).toBeVisible();
    const panel = await viewer.boundingBox();
    // MEASURE.column, centred.
    expect(panel?.width).toBe(620);
    expect((panel?.x ?? 0) * 2 + (panel?.width ?? 0)).toBe(1280);
    await expect(
      viewer.getByRole("button", { name: "Next photo" }),
    ).toHaveCount(0);
    await page.keyboard.press("Escape");
    await expect(viewer).toBeHidden();
    await expect(thumbnail).toBeFocused();

    await page.setViewportSize({ width: 390, height: 900 });
    await thumbnail.click();
    await expect(viewer).toBeVisible();
    expect(await viewer.boundingBox()).toEqual({
      x: 0,
      y: 0,
      width: 390,
      height: 900,
    });
    await expect(
      viewer.getByRole("button", { name: "Remove photo" }),
    ).toBeVisible();
  });
});
