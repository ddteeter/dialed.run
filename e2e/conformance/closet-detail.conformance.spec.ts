import { expect, test } from "@playwright/test";
import type { Page } from "@playwright/test";

import { storageStateFor } from "../support/accounts";
import { cellsOf, fillsOf, openBoard } from "../support/conformance";
import {
  closetUserId,
  removeSeededGarment,
  seedRoundTwentyTwoGarment,
} from "./closet-seed";
import type { SeededGarment } from "./closet-seed";

/**
 * Garment detail, built against round 22's `#y` frames — "Y Garment
 * detail" at 390, "Y Garment detail 1040", and "Y Retire confirm".
 *
 * **The board's own garment is seeded** (`closet-seed.ts`), so the words
 * in each region are comparable as words. Where the build cannot say what
 * the frame says, the difference is named below as a known gap with its
 * reason, and removed from the board's side before comparing — never
 * waved through by loosening the comparison. When the gap closes, its
 * normaliser stops matching and the comparison says so.
 *
 * Known gaps, each owed to something not built rather than to drift:
 *
 * - **`HALF-ZIP` in the kicker** is the garment *type* (Z2a), which only a
 *   product match supplies and this closet does not store per garment.
 * - **`· DAMP` after works-at** is the band's moisture, which no garment
 *   record holds yet.
 * - **`←` before "Closet"** is a glyph on the board and `<Icon name="back">`
 *   here: an icon is drawn, not typed, so it carries no text.
 */
test.use({ storageState: storageStateFor("closet") });

const DETAIL = "Y Garment detail";
const DETAIL_WIDE = "Y Garment detail 1040";
const CONFIRM = "Y Retire confirm";

/**
 * One frame by its exact label. The harness's `screen()` matches a
 * prefix, which is right for "A3" and wrong here: "Y Garment detail" is a
 * prefix of "Y Garment detail 1040", and a region read from both frames
 * at once is two regions' words run together.
 */
function frame(label: string): string {
  return `[data-screen-label="${label}"]`;
}

/**
The regions round 22 fixes the order of, in the names the build uses.
*/
const CONTENT_PARTS = new Set([
  "identity",
  "photo",
  "stats",
  "composition",
  "pairs-with",
  "actions",
]);

function withoutKnownGaps(cell: string): string {
  return cell
    .replace("HALF-ZIP · ", "")
    .replace(" · DAMP", "")
    .replace(/^← /u, "");
}

/**
 * Brackets as one token on both sides: the board writes `[38–46°]` as one
 * string, and `Bracketed` renders the bracket and the value as separate
 * text nodes, which the cell reader joins with a space.
 */
function tightBrackets(cell: string): string {
  return cell.replaceAll("[ ", "[").replaceAll(" ]", "]");
}

async function cells(page: Page, selector: string): Promise<string[]> {
  const found = await cellsOf(page, selector);
  return found.map((cell) => tightBrackets(cell));
}

/**
The board's cells with the known gaps taken out.
*/
async function drawnCells(page: Page, selector: string): Promise<string[]> {
  const found = await cells(page, selector);
  return found.map((cell) => withoutKnownGaps(cell));
}

/**
A region of the phone frame, and of the 1040 frame.
*/
function phonePart(name: string): string {
  return `${frame(DETAIL)} [data-part="${name}"]`;
}

function widePart(name: string): string {
  return `${frame(DETAIL_WIDE)} [data-part="${name}"]`;
}

/**
 * The content regions, in document order, as a screen actually shows them
 * — `photo-well` is the well's own name for the region the frame calls
 * `photo`, and a region that renders nothing does not count as present.
 */
async function partOrder(page: Page, root: string): Promise<string[]> {
  const names = await page.$$eval(`${root} [data-part]`, (elements) =>
    elements
      .filter((element) => {
        const box = element.getBoundingClientRect();
        return box.width > 0 && box.height > 0;
      })
      .map((element) => (element as HTMLElement).dataset.part ?? ""),
  );
  return names
    .map((name) => (name === "photo-well" ? "photo" : name))
    .filter((name) => CONTENT_PARTS.has(name));
}

/**
Whether a region's second cell sits beside its first rather than under it.
*/
async function isSideBySide(page: Page, selector: string): Promise<boolean> {
  return page.$eval(selector, (element) => {
    const [first, second] = [...element.children].map((child) =>
      child.getBoundingClientRect(),
    );
    if (first === undefined || second === undefined) return false;
    return second.top < first.bottom && second.left >= first.right;
  });
}

/**
Whether a region's last cell is pushed to its right-hand edge.
*/
async function isLastFlushRight(page: Page, selector: string): Promise<boolean> {
  return page.$eval(selector, (element) => {
    const last = element.lastElementChild;
    if (last === null) return false;
    const style = getComputedStyle(element);
    const inner =
      element.getBoundingClientRect().right -
      Number(style.paddingRight.replace("px", ""));
    return Math.abs(inner - last.getBoundingClientRect().right) < 2;
  });
}

async function box(
  page: Page,
  selector: string,
): Promise<{ width: number; height: number }> {
  const found = await page.locator(selector).first().boundingBox();
  if (found === null) throw new Error(`nothing rendered for ${selector}`);
  return found;
}

async function openDetail(page: Page, seed: SeededGarment): Promise<void> {
  await page.goto(`/closet/${seed.itemId}`);
  await page.locator('html[data-hydrated="true"]').waitFor({ state: "attached" });
}

/**
 * Where the detail's regions live in the app: the column that holds the
 * identity. Scoped so the bars' own marks never enter a comparison.
 */
const APP = "body";

/**
 * The seeded garment, held on an object rather than a reassigned binding:
 * written once in `beforeAll` and read by every test.
 */
const seeded: { garment?: SeededGarment } = {};

function seed(): SeededGarment {
  if (seeded.garment === undefined) throw new Error("nothing seeded");
  return seeded.garment;
}

test.beforeAll(async () => {
  seeded.garment = await seedRoundTwentyTwoGarment(await closetUserId());
});

test.afterAll(async () => {
  await removeSeededGarment(seed());
});

test("garment detail at 390 is composed as round 22 draws it", async ({
  page,
  baseURL,
}) => {
  if (baseURL === undefined) throw new Error("no baseURL");

  // ---- What the board draws ------------------------------------------
  await openBoard(page, "Round 22 Coverage.dc.html", baseURL);
  const drawnOrder = await partOrder(page, frame(DETAIL));
  // Guard the guard: an empty list would equal another empty list.
  expect(drawnOrder, "the board has no Y detail regions").toHaveLength(6);
  const part = phonePart;
  const drawnIdentity = await drawnCells(page, part("identity"));
  const drawnStats = await drawnCells(page, part("stats"));
  const drawnPairs = await cells(page, part("pairs-with"));
  const drawnActions = await cells(page, part("actions"));
  const drawnActionFills = await fillsOf(page, part("actions"));
  const isDrawnDeleteApart = await isLastFlushRight(page, part("actions"));
  const isDrawnStatsBeside = await isSideBySide(page, part("stats"));
  const drawnPhoto = await box(page, part("photo"));
  const drawnSwatch = await page
    .locator(`${part("identity")} [data-content]`)
    .count();

  // ---- What we built --------------------------------------------------
  await page.setViewportSize({ width: 390, height: 900 });
  await openDetail(page, seed());

  expect(await partOrder(page, APP)).toStrictEqual(drawnOrder);

  // The frame's header carries "← Closet" on the phone; ours is the first
  // line of the identity, so the rest of the identity is compared.
  const builtIdentity = await cells(page, '[data-part="identity"]');
  expect(builtIdentity.slice(1)).toStrictEqual(drawnIdentity);
  await expect(
    page.locator('[data-part="identity"] [data-content]'),
  ).toHaveCount(drawnSwatch);

  expect(await cells(page, '[data-part="stats"]')).toStrictEqual(drawnStats);
  expect(await isSideBySide(page, '[data-part="stats"]')).toBe(
    isDrawnStatsBeside,
  );
  expect(await cells(page, '[data-part="pairs-with"]')).toStrictEqual(
    drawnPairs,
  );
  expect(await cells(page, '[data-part="actions"]')).toStrictEqual(
    drawnActions,
  );
  expect(await fillsOf(page, '[data-part="actions"]')).toStrictEqual(
    drawnActionFills,
  );
  expect(await isLastFlushRight(page, '[data-part="actions"]')).toBe(
    isDrawnDeleteApart,
  );

  // The photo is 4:3, full column. The frame's column is 350 and ours is
  // the phone gutter's, so it is the proportion that is compared.
  const builtPhoto = await box(page, '[data-part="photo-well"]');
  expect(builtPhoto.height / builtPhoto.width).toBeCloseTo(
    drawnPhoto.height / drawnPhoto.width,
    2,
  );
});

test("garment detail at 1040 keeps the order in one column, photo capped at 320", async ({
  page,
  baseURL,
}) => {
  if (baseURL === undefined) throw new Error("no baseURL");

  await openBoard(page, "Round 22 Coverage.dc.html", baseURL);
  const part = widePart;
  const drawnIdentity = await drawnCells(page, part("identity"));
  expect(drawnIdentity, "the board has no Y 1040 identity").not.toHaveLength(0);
  const drawnStats = await drawnCells(page, part("stats"));
  const isDrawnStatsBeside = await isSideBySide(page, part("stats"));
  const drawnActions = await cells(page, part("actions"));
  const isDrawnDeleteApart = await isLastFlushRight(page, part("actions"));
  const drawnPhoto = await box(page, part("photo"));

  await page.setViewportSize({ width: 1040, height: 900 });
  await openDetail(page, seed());

  // At width the way back is the identity's first line, as drawn. The
  // 1040 frame leaves the colourway line out with the rest it elides, so
  // the lines it does draw are compared.
  const builtIdentity = await cells(page, '[data-part="identity"]');
  expect(builtIdentity.slice(0, drawnIdentity.length)).toStrictEqual(
    drawnIdentity,
  );

  // "The stats line and works-at share a row at width."
  expect(await cells(page, '[data-part="stats"]')).toStrictEqual(drawnStats);
  expect(await isSideBySide(page, '[data-part="stats"]')).toBe(
    isDrawnStatsBeside,
  );
  expect(await cells(page, '[data-part="actions"]')).toStrictEqual(
    drawnActions,
  );
  expect(await isLastFlushRight(page, '[data-part="actions"]')).toBe(
    isDrawnDeleteApart,
  );

  // DS3's cap, which the photo used to break at desk (D-102): 320 tall,
  // letterboxed rather than cropped.
  const builtPhoto = await box(page, '[data-part="photo-well"]');
  expect(Math.round(builtPhoto.height)).toBe(Math.round(drawnPhoto.height));
});

test("the retire confirm is composed as round 22 draws it", async ({
  page,
  baseURL,
}) => {
  if (baseURL === undefined) throw new Error("no baseURL");

  await openBoard(page, "Round 22 Coverage.dc.html", baseURL);
  const drawn = `${frame(CONFIRM)} [data-part="sheet"][data-state="confirm-retire"]`;
  const drawnSheet = await cells(page, drawn);
  expect(drawnSheet, "the board has no retire sheet").not.toHaveLength(0);
  const drawnFills = await fillsOf(page, drawn);

  await page.setViewportSize({ width: 390, height: 900 });
  await openDetail(page, seed());
  await page
    .locator('[data-part="actions"]')
    .getByRole("button", { name: "Retire" })
    .click();

  const built = '[data-part="sheet"][data-state="confirm-retire"]';
  await page.locator(built).waitFor({ state: "visible" });

  // Heading, the two sentences, the verb that opened it, Keep it — the
  // board's own words, because the seeded garment is the board's.
  expect(await visibleCells(page, built)).toStrictEqual(drawnSheet);
  expect(await fillsOf(page, built)).toStrictEqual(drawnFills);
  // "Focus lands on Keep it."
  await expect(page.getByRole("button", { name: "Keep it" })).toBeFocused();

  await page.getByRole("button", { name: "Keep it" }).click();
  await expect(page.locator(built)).toBeHidden();
});

/**
 * `cellsOf`, reading only the text a person can see. A control's in-flight
 * label is in the DOM from the start — `PendingLabel` stacks both halves
 * so the button keeps its size — and is `visibility: hidden` until needed.
 */
async function visibleCells(page: Page, selector: string): Promise<string[]> {
  const raw = await page.$$eval(`${selector} > *`, (children) =>
    children.map((child) => {
      const walker = document.createTreeWalker(child, NodeFilter.SHOW_TEXT);
      const words: string[] = [];
      for (let node = walker.nextNode(); node !== null; node = walker.nextNode()) {
        const parent = node.parentElement;
        if (parent === null) continue;
        if (getComputedStyle(parent).visibility === "hidden") continue;
        const text = (node.textContent ?? "").trim();
        if (text !== "") words.push(text);
      }
      return words.join(" ").replaceAll(/\s+/gu, " ").toUpperCase();
    }),
  );
  return raw.filter((cell) => cell !== "").map((cell) => tightBrackets(cell));
}
