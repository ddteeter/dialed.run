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

    // ---- Round 18 · the brackets frame the cell, not the words --------
    //
    // *"They start at the cell's outer edges, vertically centred, and
    // slide inward by TRAVEL.frame while the fill lands. A wrapping label
    // ('A bit / cold') never splits the pair; the pair never enters the
    // text."*
    //
    // Asserted here rather than in a unit test for the same reason the row
    // is: happy-dom lays nothing out, so "is the bracket outside the text"
    // is not a question it can answer. It was answered wrong twice — first
    // as three stacked rows, then as an inline pair split across the
    // label's two lines — and both looked correct in the markup.
    await page.setViewportSize(PHONE);
    await page.goto(`/feed/verdict/${entryId}`);
    await page.locator('html[data-hydrated="true"]').waitFor({
      state: "attached",
    });

    // The two-word label, because a single-word one would wrap to one line
    // and prove nothing about splitting the pair.
    const chosen = page.getByRole("button", { name: "A bit cold" });
    await chosen.click();

    // **Wait for the close to finish before measuring.** The brackets
    // animate inward by TRAVEL.frame over `--dur-reveal`, so a box read
    // straight after the click is a box mid-slide — which showed up as a
    // frame lopsided by 3.8px of the 8px travel. Waiting on the element's
    // own animations rather than a timeout keeps it deterministic if the
    // duration ever changes.
    await page
      .locator(".bracket-close-start")
      .evaluate(async (element) => {
        await Promise.all(
          element.getAnimations().map(async (animation) => animation.finished),
        );
      });

    const cell = await chosen.boundingBox();
    const open = await page.locator(".bracket-close-start").boundingBox();
    const close = await page.locator(".bracket-close-end").boundingBox();
    if (!cell || !open || !close) throw new Error("no bracket boxes");

    // The label's own text node, measured with a Range — an element box
    // would be the cell's, which is the thing the brackets are pinned to
    // and would make "never enters the text" trivially true.
    const label = await chosen.evaluate((button) => {
      const text = [...button.childNodes].filter(
        (node) => node.nodeType === 3 && (node.textContent ?? "").trim() !== "",
      );
      const range = document.createRange();
      for (const node of text) range.selectNodeContents(node);
      const box = range.getBoundingClientRect();
      return { x: box.x, right: box.x + box.width, height: box.height };
    });

    // **Two lines**, which is the condition the ruling is about. If the
    // label ever fits on one, this test stops proving what it claims.
    expect(
      label.height,
      "the label no longer wraps, so this proves nothing",
    ).toBeGreaterThan(20);

    // **Never enters the text**, on either side.
    expect(open.x + open.width, "[ overlaps the label").toBeLessThanOrEqual(
      label.x + 0.5,
    );
    expect(close.x, "] overlaps the label").toBeGreaterThanOrEqual(
      label.right - 0.5,
    );

    // **At the cell's outer edges**, symmetrically — a frame, not a pair
    // sitting beside the words.
    const leftGap = open.x - cell.x;
    const rightGap = cell.x + cell.width - (close.x + close.width);
    expect(leftGap).toBeLessThan(8);
    expect(Math.abs(leftGap - rightGap), "the frame is lopsided").toBeLessThan(
      1,
    );

    // **Vertically centred on the cell**, so a one-line and a two-line
    // label carry the brackets at the same height across the row.
    const middle = cell.y + cell.height / 2;
    for (const [name, box] of [
      ["[", open],
      ["]", close],
    ] as const) {
      expect(
        Math.abs(box.y + box.height / 2 - middle),
        `${name} is not centred on the cell`,
      ).toBeLessThan(1.5);
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
