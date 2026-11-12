import { readFileSync } from "node:fs";

import { expect, test } from "../support/a11y";
import type { Locator, Page } from "@playwright/test";

import { storageStateFor } from "../support/accounts";
import { fillOf, hydrated } from "../support/conformance";
import { signInAsKnownUser } from "../support/known-user";
import type { Seeded } from "./logging-fixtures";
import { seedItem, unseed } from "./logging-fixtures";

const UNFILLED = "transparent";

/**
 * Onboarding at desk width and P3 in light (round 49, R49·138; drawn on
 * `design/Round 49 Rulings.dc.html` at 390 and 1280).
 *
 * At ≥1040 there is no panel: the step sits in the page column,
 * left-aligned, at a desk measure, under a bar that shows only the
 * wordmark. Below 1040 nothing changes but P3's body, which leaves ink.
 *
 * Geometry is read from the page, and the measure from `tokens.js`;
 * neither is typed here.
 *
 * The `closet` account has finished onboarding, so visiting `/done` (which
 * writes `onboarding_complete`) changes nothing another spec reads.
 */
test.use({ storageState: storageStateFor("closet") });

const BAR = "header[data-part='top-bar']";
// P3's band holds the h1; the body is the block after it.
const BAND = "main div:has(> h1)";
const BODY = `${BAND} + div`;

async function open(page: Page, path: string, width: number): Promise<void> {
  await page.setViewportSize({ width, height: 900 });
  await page.goto(path);
  await hydrated(page);
}

/**
 * `MEASURE.column`, read from the contract itself (`design/tokens.js`)
 * rather than typed here.
 */
function columnMeasure(): number {
  const tokens = readFileSync(
    new URL("../../design/tokens.js", import.meta.url),
    "utf8",
  );
  const found = /MEASURE = \{[^}]*?column:\s*(?<px>\d+)/u.exec(tokens);
  return Number(found?.groups?.px);
}

async function box(locator: Locator): Promise<{ x: number; width: number }> {
  const found = await locator.boundingBox();
  if (found === null) throw new Error("not laid out");
  return found;
}

test("O1 at 1280: the step left-aligns in the page column under a wordmark-only bar", async ({
  page,
}) => {
  await open(page, "/onboarding/calibrate", 1280);

  const bar = page.locator(BAR);
  await expect(bar).toBeVisible();
  await expect(bar.getByRole("link")).toHaveCount(0);
  await expect(bar.getByRole("navigation")).toHaveCount(0);
  await expect(bar).toContainText("dialed.run");
  await expect(page.locator("[data-slot='tab-bar']")).toHaveCount(0);

  const main = await box(page.getByRole("main"));
  const step = await box(page.getByRole("main").locator("> div"));
  // Left-aligned in the column, not centred in the window.
  expect(step.x).toBe(main.x);
  expect(step.width).toBeLessThanOrEqual(columnMeasure());
  expect(main.width).toBeGreaterThan(step.width);
});

test("O1 at 390: nothing changes, no bar and the panel", async ({ page }) => {
  await open(page, "/onboarding/calibrate", 390);

  await expect(page.locator(BAR)).toBeHidden();
  await expect(page.getByRole("banner")).toHaveCount(0);
});

test("P3 at 1280: the band runs the column, the body keeps the measure, on the ground", async ({
  page,
}) => {
  await open(page, "/onboarding/done", 1280);

  const heading = page.getByRole("heading", { name: "Now go run." });
  const band = heading.locator("..");
  const body = band.locator("xpath=following-sibling::div[1]");
  const measure = columnMeasure();

  const bandBox = await box(band);
  const bodyBox = await box(body);
  expect(bandBox.width).toBeGreaterThan(measure);
  expect(bodyBox.width).toBeLessThanOrEqual(measure);
  // The band is the one fill; the body wears none, so it is the ground.
  expect(await fillOf(page, BAND)).not.toBe(UNFILLED);
  expect(await fillOf(page, BODY)).toBe(UNFILLED);
});

test("P3 at 390: the body is light as well", async ({ page }) => {
  await open(page, "/onboarding/done", 390);

  expect(await fillOf(page, BODY)).toBe(UNFILLED);
  await expect(page.locator(BAR)).toBeHidden();
});

// O3 and P2.5 have no drawing at 390 to compare with here; they end at
// the phone's width so what a screen reader says on each is checked in
// (#582). Nothing is saved: the closet account's closet is other specs'.
test("O3 at 390: every row is a checkbox, and the counter counts the taps", async ({
  page,
}) => {
  await open(page, "/onboarding/taplist", 390);

  await page.getByRole("checkbox", { name: "Running tights" }).check();
  await page.getByRole("checkbox", { name: "Beanie" }).check();
  await expect(page.getByText("Closet: 2 pieces")).toBeVisible();
  await expect(
    page.getByRole("checkbox", { name: "Running tights" }),
  ).toBeChecked();
});

test.describe("P2.5, for a runner with generic pieces", () => {
  test.use({ storageState: { cookies: [], origins: [] } });

  const seeded: Seeded = {
    userId: "e2e-naming",
    runIds: [],
    itemIds: [],
    entryIds: [],
  };

  test.afterEach(async () => {
    await unseed(seeded);
  });

  test("P2.5 at 390: a piece open for naming, with brands on offer", async ({
    page,
  }) => {
    await signInAsKnownUser(page, seeded.userId, "naming_pieces");
    await seedItem(seeded, "Merino base layer", "top");
    await seedItem(seeded, "Running tights", "bottom");
    await open(page, "/onboarding/name", 390);

    await expect(page.getByText("0 of 2 named")).toBeVisible();
    await page.getByRole("button", { name: "Name it" }).first().click();
    await page.getByLabel("Brand").fill("Sm");
    await expect(
      page.locator("datalist[id^='brands-'] option"),
    ).not.toHaveCount(0);
  });
});
