import { expect, test } from "@playwright/test";
import type { Page } from "@playwright/test";

import { storageStateFor } from "../support/accounts";
import { DESK, PHONE } from "../support/bars";
import type { Seeded } from "./logging-fixtures";
import {
  hydrated,
  seedEntry,
  seedItem,
  seedRun,
  unseed,
  userIdOf,
} from "./logging-fixtures";

/**
 * Log a run at the desk (design round 25): from 1040, A1–A3 are DS1's two
 * columns — every input and the primary action in the primary column,
 * read-only context cards in `data-part="rail"` beside it. *"The harness
 * checks this: no input, button, [role=radio] inside data-part="rail"."*
 *
 * Checked in a real browser because happy-dom lays nothing out: "beside"
 * is a question about boxes.
 */
test.use({ storageState: storageStateFor("verdict") });

const CONTROLS = "input, button, select, textarea, [role='radio']";

/**
 * The rail sits to the right of the primary column, holds no control, and
 * the primary column stays inside the 620 measure.
 */
async function expectRailBeside(page: Page, primary: string): Promise<void> {
  const rail = page.locator('[data-part="rail"]');
  await expect(rail).toBeVisible();
  await expect(rail.locator(CONTROLS)).toHaveCount(0);
  const railBox = await rail.boundingBox();
  const primaryBox = await page.locator(primary).first().boundingBox();
  if (railBox === null || primaryBox === null) throw new Error("no boxes");
  expect(railBox.x).toBeGreaterThanOrEqual(primaryBox.x + primaryBox.width);
  expect(primaryBox.width).toBeLessThanOrEqual(620);
}

test("A2 and A3 at the desk: the step in the column, a read-only rail beside it", async ({
  page,
}) => {
  const seeded: Seeded = {
    userId: await userIdOf("verdict"),
    runIds: [],
    itemIds: [],
    entryIds: [],
  };
  const itemId = await seedItem(seeded, "Rail half-zip", "top");
  const kitless = await seedRun(seeded, {
    observed: true,
    weatherStatus: "attached",
    startedAt: 1_780_000_000,
  });
  const judged = await seedRun(seeded, {
    observed: true,
    weatherStatus: "attached",
  });
  const entryId = await seedEntry(seeded, judged, [itemId]);

  try {
    await page.setViewportSize(DESK);

    await page.goto(`/feed/attach/${kitless}`);
    await hydrated(page);
    await expectRailBeside(page, "form, [data-slot='header']");

    await page.goto(`/feed/verdict/${entryId}`);
    await hydrated(page);
    await expectRailBeside(page, "form");
    await expect(page.locator('[data-part="rail"]')).toContainText(
      "Rail half-zip",
    );

    // The phone never had these cards.
    await page.setViewportSize(PHONE);
    await expect(page.locator('[data-part="rail"]')).toBeHidden();
  } finally {
    await unseed(seeded);
  }
});
