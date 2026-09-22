/**
 * A3's five verdict buttons are one row at every width.
 *
 * Design round 17, in as many words: *"the five are one row at every width
 * — in the 390 desk panel too; never a stack, never wider than the panel.
 * Neither the row nor the chips sit inside a field box."*
 *
 * **Only a real browser can assert this.** The `ui` project runs in
 * happy-dom, which parses CSS but lays nothing out: every
 * `getBoundingClientRect()` there is zero, so a unit test can assert the
 * grid *class* and learn nothing about whether five two-word labels
 * actually fit across 350px of panel. That gap is the whole reason the
 * stack shipped — it was `flex flex-col`, the class was as intended, and
 * the tests were green.
 *
 * Not in `verdict.demo.spec.ts`, because a demo spec is one journey and
 * one video; a geometry check beside it would record a second video next
 * to the one a reviewer is meant to watch.
 */
import { eq, inArray } from "drizzle-orm";

import {
  outfitEntries,
  outfitEntryItems,
  runs,
  wardrobeItems,
} from "../../src/db/schema-core";
import { user } from "../../src/db/schema-auth";
import { newUlid } from "../../src/lib/ids";
import { nowSeconds } from "../../src/lib/now";
import { accountEmail, storageStateFor } from "../support/accounts";
import { withLocalDb } from "../support/local-db";
import { expect, test } from "@playwright/test";

test.use({ storageState: storageStateFor("verdict") });

const PHONE = { width: 390, height: 844 };
const DESK = { width: 1280, height: 720 };

test("the five verdict buttons sit in one row at 390 and at 1280", async ({
  page,
}) => {
  const itemId = newUlid();
  const runId = newUlid();
  const entryId = newUlid();
  const startedAt = nowSeconds() - 3600;

  // Scoped to ids this spec generated, so the cleanup below cannot take a
  // developer's local rows with it.
  await withLocalDb(async ({ core }) => {
    const [row] = await core
      .select({ id: user.id })
      .from(user)
      .where(eq(user.email, accountEmail("verdict")))
      .limit(1);
    if (!row) throw new Error("no verdict account — demo-setup did not run");

    await core.insert(wardrobeItems).values({
      id: itemId,
      userId: row.id,
      name: "Houdini Jacket",
      brand: "Patagonia",
      category: "top",
      layer: "outer",
      createdAt: startedAt,
    });
    await core.insert(runs).values({
      id: runId,
      userId: row.id,
      title: "Row geometry",
      startedAt,
      durationS: 2700,
      distanceM: 8000,
      source: "manual",
      indoor: false,
      weatherStatus: "attached",
    });
    await core.insert(outfitEntries).values({
      id: entryId,
      userId: row.id,
      runId,
      isPublic: false,
      createdAt: startedAt,
    });
    await core.insert(outfitEntryItems).values({ entryId, itemId });
  });

  try {
    for (const viewport of [PHONE, DESK]) {
      await page.setViewportSize(viewport);
      await page.goto(`/feed/verdict/${entryId}`);

      // Every verdict label from `verdictScale`, in order. Named rather
      // than counted: five buttons in a row proves nothing if they are the
      // wrong five.
      const labels = [
        "Way cold",
        "A bit cold",
        "Dialed",
        "A bit warm",
        "Way warm",
      ];
      const boxes = [];
      for (const label of labels) {
        const button = page.getByRole("button", { name: label });
        // `toBeVisible` first: `boundingBox()` does not auto-wait, so
        // reading it straight after a `goto` can measure a button the
        // browser has not laid out yet and report a plausible-looking
        // zero.
        await expect(button).toBeVisible();
        const box = await button.boundingBox();
        if (!box) throw new Error(`${label} has no box at ${String(viewport.width)}`);
        boxes.push(box);
      }

      const width = String(viewport.width);

      // **One row.** Same top edge for all five, within a pixel of
      // rounding. A stack would put them 50-odd pixels apart.
      const tops = boxes.map((box) => box.y);
      const spread = Math.max(...tops) - Math.min(...tops);
      expect(spread, `verdict buttons are not on one row at ${width}`).toBeLessThan(2);

      // **In order, left to right.** `grid-cols-5` guarantees it, but the
      // scale's order is the product rule (way cold → way warm) and a
      // reversed row would still be one row.
      for (let i = 1; i < boxes.length; i += 1) {
        const previous = boxes[i - 1];
        const current = boxes[i];
        if (!previous || !current) throw new Error("missing box");
        expect(
          current.x,
          `${labels[i] ?? ""} is left of ${labels[i - 1] ?? ""} at ${width}`,
        ).toBeGreaterThan(previous.x);
      }

      // **Never wider than the panel**, and the labels are inside their
      // cells rather than spilling out of them. `scrollWidth` over
      // `clientWidth` is the check that catches an overflowing row, which
      // a bounding box on its own does not — an overflowing child still
      // reports a box.
      // `.last()`, not `.first()`: the filter matches every ancestor div
      // that contains the button, and the outermost is the form's own
      // column — measuring that would pass however far the row spilled.
      // The innermost is the grid.
      const row = page
        .locator("form div")
        .filter({ has: page.getByRole("button", { name: "Way cold" }) })
        .last();
      const overflow = await row.evaluate((element) => ({
        scrollWidth: element.scrollWidth,
        clientWidth: element.clientWidth,
      }));
      expect(
        overflow.scrollWidth,
        `the verdict row overflows its panel at ${width}`,
      ).toBeLessThanOrEqual(overflow.clientWidth + 1);
    }
  } finally {
    await withLocalDb(async ({ core }) => {
      await core
        .delete(outfitEntryItems)
        .where(eq(outfitEntryItems.entryId, entryId));
      await core.delete(outfitEntries).where(eq(outfitEntries.id, entryId));
      await core.delete(runs).where(inArray(runs.id, [runId]));
      await core
        .delete(wardrobeItems)
        .where(inArray(wardrobeItems.id, [itemId]));
    });
  }
});
