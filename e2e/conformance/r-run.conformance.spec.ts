import { expect, test } from "@playwright/test";

import { storageStateFor } from "../support/accounts";
import {
  cellsOf,
  colorRole,
  openBoard,
  part,
  signatureOf,
} from "../support/conformance";
import type { Seeded } from "./logging-fixtures";
import {
  hydrated,
  lookOf,
  seedRun,
  unseed,
  userIdOf,
} from "./logging-fixtures";

/**
 * "R Run before kit" (Round 22 Coverage): a run the weather gave up on,
 * with no kit yet. No inputs on the screen; the conditions row says what
 * is missing and offers R2b; the primary is the log verb into A2.
 *
 * The run strip is compared by shape — its date, time and source are the
 * run's own — and the rest by words, fill and frame.
 */
test.use({ storageState: storageStateFor("run-logging") });

const LABEL = "R Run before kit";

/**
Apostrophes as typed, so a board's `'` and our `’` compare as one.
*/
function plain(cells: readonly string[]): string[] {
  return cells.map((cell) => cell.replaceAll("’", "'"));
}

test.describe("R · a run before its kit", () => {
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
    runId = await seedRun(seeded, { observed: false, weatherStatus: "failed" });
  });

  test.afterEach(async () => {
    await unseed(seeded);
  });

  test("is composed as the board draws it", async ({ page, baseURL }) => {
    if (baseURL === undefined) throw new Error("no baseURL");
    await openBoard(page, "Round 22 Coverage.dc.html", baseURL);
    const drawnStrip = await signatureOf(page, part(LABEL, "run-strip"));
    const drawnConditions = await cellsOf(page, part(LABEL, "conditions"));
    const drawnConditionsLook = await lookOf(page, part(LABEL, "conditions"));
    const drawnKit = await cellsOf(page, part(LABEL, "kit"));
    const drawnPrimary = await signatureOf(page, part(LABEL, "primary-action"));
    const drawnPrimaryLook = await lookOf(page, part(LABEL, "primary-action"));
    expect(drawnConditions, "the board has no conditions row").not.toHaveLength(
      0,
    );

    await page.setViewportSize({ width: 390, height: 900 });
    await page.goto(`/runs/${runId}`);
    await hydrated(page);

    // The strip: a mono line, then the distance beside the pace.
    const strip = await signatureOf(page, '[data-slot="run-strip"]');
    expect(strip).toHaveLength(drawnStrip.length);
    expect(strip[1]?.length).toBe(drawnStrip[1]?.length);
    expect(strip[1]?.[0]).toBe("6.2 MI");

    // No conditions · Set ›, in a hairline card, and no input anywhere.
    await expect(page.locator('[data-slot="conditions"]')).toHaveAttribute(
      "data-state",
      "unavailable",
    );
    expect(await cellsOf(page, '[data-slot="conditions"]')).toEqual(
      drawnConditions,
    );
    const conditions = await lookOf(page, '[data-slot="conditions"]');
    expect(conditions.borderStyle).toBe(drawnConditionsLook.borderStyle);
    expect(colorRole(conditions.borderColor)).toBe(
      colorRole(drawnConditionsLook.borderColor),
    );
    // The run screen, not the bar above it: no field on it at all.
    const screen = page.locator('[data-slot="run-strip"]').locator("..");
    await expect(screen.locator("input")).toHaveCount(0);

    expect(plain(await cellsOf(page, '[data-slot="kit"]'))).toEqual(
      plain(drawnKit),
    );

    expect(await signatureOf(page, '[data-slot="primary-action"]')).toEqual(
      drawnPrimary,
    );
    const primary = await lookOf(page, '[data-slot="primary-action"]');
    expect(colorRole(primary.fill)).toBe(colorRole(drawnPrimaryLook.fill));
  });
});
