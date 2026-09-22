import { eq } from "drizzle-orm";
import { expect, test } from "@playwright/test";

import { user } from "../../src/db/schema-auth";
import {
  outfitEntries,
  outfitEntryItems,
  runs,
  wardrobeItems,
} from "../../src/db/schema-core";
import { newUlid } from "../../src/lib/ids";
import { nowSeconds } from "../../src/lib/now";
import { accountEmail, storageStateFor } from "../support/accounts";
import {
  cellsOf,
  openBoard,
  part,
  signatureOf,
} from "../support/conformance";
import { withLocalDb } from "../support/local-db";

/**
 * A3's verdict row, built against drawn.
 *
 * **The first screen through the conformance harness**, and the one worth
 * doing first because it is where the technique was invented: three
 * defects shipped on this control inside a day, all of them invisible to
 * 3,480 passing unit tests, because the `ui` project runs in happy-dom and
 * happy-dom lays nothing out. In order they were a vertical stack where
 * the ruling said one row, "Dialed" floating off its neighbours' baseline,
 * and the brackets first stacking as rows of their own and then splitting
 * across a wrapping label.
 *
 * The middle one is the reason this file exists rather than more geometry
 * assertions. A geometry test checks a rule someone remembered to write
 * down; this checks the drawing. "Dialed" was found by diffing a signature
 * against the board, and nobody would have thought to assert "the five
 * labels share a first baseline" in advance.
 *
 * **Region, not whole screen.** Design's round-18 packet names the regions
 * (`data-part`), and this repo already spelled the same idea `data-slot`
 * on the two bars. Comparing `verdict-row` to `verdict-row` means the
 * board's fake conditions and our real ones never enter the diff, and a
 * failure reports against a region a person can open.
 */
test.use({ storageState: storageStateFor("verdict") });

/**
Design's label for the screen, on both the light and dark boards.
*/
const A3 = "A3";

/**
 * Differences confirmed real, not yet closed, and deliberately not
 * silent.
 *
 * **A conformance harness with no way to record a known gap gets
 * deleted.** The first screen through it found one, and the choice was
 * either to leave the check red — which trains everyone to ignore it — or
 * to fix a feature inside a testing PR. Neither. A gap is written here
 * with the register entry that owns it, and the test asserts it is *still
 * needed*: close the gap and this fails, telling you to delete the line.
 *
 * It is not a suppression. A suppression hides a difference; this one is
 * enumerated, and the count is reviewable.
 */
const KNOWN_GAPS: ReadonlyMap<string, string> = new Map([
  // D-97: the board's dialed cell carries the runner's count in this
  // temperature band ("7 IN BAND"); we draw the word alone. That is a
  // feature — A3 has the history query behind it already — and not a
  // composition bug, so it is owned by the register rather than fixed
  // inside the PR that found it.
  ["DIALED 7 IN BAND", "DIALED"],
]);


test("A3's verdict row is composed as the board draws it", async ({
  page,
  baseURL,
}) => {
  if (baseURL === undefined) throw new Error("no baseURL");

  // ---- What the board draws ------------------------------------------
  await openBoard(page, "Product Screens.dc.html", baseURL);
  const drawnCells = await cellsOf(page, part(A3, "verdict-row"));

  // Guard the guard: a selector that matches nothing returns an empty
  // signature, and an empty signature would compare equal to another
  // empty one. Every assertion below is worthless without this.
  expect(
    drawnCells,
    "the board has no A3 verdict-row region — has the packet changed?",
  ).not.toHaveLength(0);

  // ---- What we built --------------------------------------------------
  const itemId = newUlid();
  const runId = newUlid();
  const entryId = newUlid();
  const startedAt = nowSeconds() - 3600;

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
      title: "Conformance",
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
    // The width the board is drawn at, since round 18 moved the wrappers
    // from 380 to the device's own 390.
    await page.setViewportSize({ width: 390, height: 900 });
    await page.goto(`/feed/verdict/${entryId}`);
    await page
      .locator('html[data-hydrated="true"]')
      .waitFor({ state: "attached" });

    const builtCells = await cellsOf(page, '[data-slot="verdict-row"]');
    const builtRows = await signatureOf(page, '[data-slot="verdict-row"]');
    expect(builtCells, "the app has no verdict-row region").not.toHaveLength(0);

    // **The same cells, with the same words, in the same order.**
    //
    // Cell by cell rather than row by row, because the two legitimately
    // fold at different points — the board's cells are a couple of pixels
    // narrower, so "WAY COLD" breaks there and not here. A cell's text
    // does not care where it folded.
    const expected = drawnCells.map((cell) => KNOWN_GAPS.get(cell) ?? cell);
    expect(builtCells).toEqual(expected);

    // **Every known gap is still a gap.** Without this the map is a
    // suppression that outlives the thing it suppressed: close D-97 and
    // the entry would go on quietly rewriting a cell that no longer
    // needs it, hiding the next difference in that same cell.
    for (const drawn of KNOWN_GAPS.keys()) {
      expect(
        drawnCells,
        `${drawn} is no longer drawn — delete its KNOWN_GAPS entry`,
      ).toContain(drawn);
    }

    // **And the cells really are one band**, which is the question rows
    // do answer and cells cannot: the comparison above would pass just as
    // happily against a vertical stack of five, which is exactly what
    // this control shipped. The board lays its labels across at most two
    // rows, the second being the wrapped half of the first.
    expect(
      builtRows.length,
      "the verdict labels are stacked, not laid across one band",
    ).toBeLessThanOrEqual(2);

    // **Every cell starts on the first row.** "Dialed" is one word where
    // its neighbours are two, and centred vertically it floated to the
    // middle of its cell while their first lines sat above it — five
    // labels sharing no baseline. Found by diffing against this board,
    // and nobody would have thought to assert it in advance.
    expect(
      builtRows[0],
      "not every label starts on the band's first row",
    ).toHaveLength(builtCells.length);
  } finally {
    await withLocalDb(async ({ core }) => {
      await core
        .delete(outfitEntryItems)
        .where(eq(outfitEntryItems.entryId, entryId));
      await core.delete(outfitEntries).where(eq(outfitEntries.id, entryId));
      await core.delete(runs).where(eq(runs.id, runId));
      await core.delete(wardrobeItems).where(eq(wardrobeItems.id, itemId));
    });
  }
});
