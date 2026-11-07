/**
 * Covers, beside `closet.journey.spec.ts`, what F does off the happy
 * path: its order — what it is before its link (round 35 #52b, round 43
 * #93) — and its select's ▾ (design-deltas 104); the product link checked
 * on leaving the box, and a shortened link refused at the save with the
 * rest of the piece kept (R-176, design 171); W3's Pick another swapping
 * the photo in place (round 28 #5); round 26 #10 (F at the desk, "←
 * Closet" from #9), R-112 (the rail by type) and round 28 #13 (the hatch
 * and "RETIRED MAR 2026", the merge words in ink); and R-137 (a brand
 * written in any script).
 *
 * The closet account is the journey's too, and the journey opens on an
 * empty closet: every test here removes what it made — the rows it seeded
 * by their ids, and what a save made by its name.
 */
import { nowSeconds } from "../../src/lib/now";
import { storageStateFor } from "../support/accounts";
import { expect, test } from "../support/a11y";
import { hydrated } from "../support/demo";
import {
  PNG_1X1,
  PNG_2X1,
  itemsNamed,
  removeItems,
  removeProductPieces,
  seedProductPiece,
} from "./closet-support";

test.use({ storageState: storageStateFor("closet") });

test("F puts what it is before its link, and draws its own ▾", async ({
  page,
}) => {
  await page.goto("/closet/new");
  await hydrated(page);
  const category = page.getByLabel("Category");
  await expect(category).toBeVisible();
  // Round 35 #52b: what it is comes first, at every width — and round 43
  // #93's link after it, since a link reads nothing without a brand and a
  // model.
  const order = await page
    .locator("form", { has: category })
    .locator(
      "[name='category'], [name='brand'], [name='name'], [name='productUrl']",
    )
    .evaluateAll((controls) =>
      controls.map((control) => control.getAttribute("name")),
    );
  expect(order).toStrictEqual(["category", "brand", "name", "productUrl"]);
  // Design-deltas 104: the native arrow is gone, and ▾ sits as far in from
  // the field box's right edge as the label sits from its left (the box's
  // border and px-4, on both sides).
  await expect(category).toHaveCSS("appearance", "none");
  const arrow = category.locator("xpath=following-sibling::*[1]");
  await expect(arrow).toHaveText("▾");
  await expect(arrow).toHaveAttribute("aria-hidden", "true");
  const fieldBox = await category
    .locator("xpath=ancestor::*[contains(@class, 'field-box')][1]")
    .boundingBox();
  const selectBox = await category.boundingBox();
  const arrowBox = await arrow.boundingBox();
  if (fieldBox === null || selectBox === null || arrowBox === null) {
    throw new Error("F's category field or its ▾ is not laid out");
  }
  const leftInset = selectBox.x - fieldBox.x;
  expect(leftInset).toBeGreaterThan(8);
  expect(
    fieldBox.x + fieldBox.width - (arrowBox.x + arrowBox.width),
  ).toBeCloseTo(leftInset, 0);
});

test("F's product link: http is refused on leaving the box, a shortener at the save", async ({
  page,
}) => {
  const name = `Pegasus ${String(Date.now()).slice(-6)}`;
  await page.goto("/closet/new");
  await hydrated(page);
  await page.getByLabel("Category").selectOption("shoes");
  await page.getByLabel("Brand").fill("Nike");
  await page.getByLabel("Model / name").fill(name);
  // Round 43 #93: checked when the runner leaves the box, never while
  // typing, and a link pasted without its scheme gets https:// on save.
  const link = page.getByLabel(/Product link/);
  await link.fill(["http:", "//nike.com/pegasus"].join(""));
  await link.blur();
  await expect(
    page.getByText("Use a link that starts with https://."),
  ).toBeVisible();
  await link.fill("nike.com/pegasus");
  await link.blur();
  await expect(
    page.getByText("Use a link that starts with https://."),
  ).toHaveCount(0);
  // R-176 (design 171): a shortener goes wherever its owner points it, so
  // the denylist starts with them. The save refuses the link on its own
  // field and keeps the rest of the piece, as for any denied link.
  await link.fill("https://bit.ly/pegasus41");
  await page.getByRole("button", { name: "Add to closet" }).click();
  await expect(
    page.getByText(
      "That link isn't allowed here. The rest of the piece is fine.",
    ),
  ).toBeVisible();
  await expect(page.getByLabel("Brand")).toHaveValue("Nike");
  await expect(page.getByLabel("Model / name")).toHaveValue(name);
});

test("W3 · Pick another swaps the photo in place, and that one is attached", async ({
  page,
}) => {
  await page.goto("/closet/new");
  await hydrated(page);
  const well = page.locator("[data-part='photo-well']");
  await page.setInputFiles('[data-part="photo-well"] input[type="file"]', {
    name: "houdini-first.png",
    mimeType: "image/png",
    buffer: PNG_1X1,
  });
  // Round 28 #5: W3 stays open once auto-blur paints, and nothing is
  // attached until Use this photo. Pick another swaps the photo in place.
  const use = page.getByRole("button", { name: "Use this photo" });
  await expect(use).not.toHaveAttribute("aria-disabled", "true", {
    timeout: 20_000,
  });
  const choosing = page.waitForEvent("filechooser");
  await page
    .locator("[data-part='photo-check']")
    .getByText("Pick another", { exact: true })
    .click();
  const chooser = await choosing;
  await chooser.setFiles({
    name: "houdini.png",
    mimeType: "image/png",
    buffer: PNG_2X1,
  });
  await use.click({ timeout: 20_000 });
  await expect(well).toHaveAttribute("data-state", "filled", {
    timeout: 20_000,
  });
  const preview = well.locator('img[src^="blob:"]');
  // The photo attached is the one Pick another chose, not the first: it
  // is the 2x1 one, twice as wide as it is tall.
  await expect
    .poll(() =>
      preview.evaluate((image: HTMLImageElement) =>
        image.naturalHeight === 0
          ? 0
          : image.naturalWidth / image.naturalHeight,
      ),
    )
    .toBe(2);
});

test("F at the desk · what is already in your closet, by category and type", async ({
  page,
}) => {
  // The rail holds one card: what is already in the closet in the category
  // being added, newest first, read-only. It follows the category, and
  // marks a piece whose brand and name match what is typed.
  const jacket = { name: `Houdini ${String(Date.now()).slice(-6)}` };
  const shoe = { name: `Pegasus ${String(Date.now()).slice(-6)}` };
  const pieces = [
    await seedProductPiece({
      ...jacket,
      category: "top",
      type: "jacket",
      brand: "Patagonia",
      origin: "manual",
    }),
    await seedProductPiece({
      ...shoe,
      category: "shoes",
      brand: "Nike",
      origin: "manual",
      retired: true,
      retiredAt: nowSeconds(),
    }),
  ];
  try {
    await page.goto("/closet/new");
    await expect(
      page.getByRole("heading", { level: 1, name: "Add a garment" }),
    ).toBeVisible();
    await hydrated(page);
    // Round 26 #9: the way back reads "← Closet".
    await expect(
      page.getByRole("link", { name: "Closet" }).first(),
    ).toBeVisible();
    await page.getByLabel("Category").selectOption("top");
    const rail = page.locator("[data-part='rail']");
    await expect(
      rail.getByRole("heading", { name: "Already in your closet · Top" }),
    ).toBeVisible();
    await expect(rail.getByText(`Patagonia ${jacket.name}`)).toBeVisible();
    await page.getByLabel("Brand").fill("Patagonia");
    await page.getByLabel("Model / name").fill(jacket.name);
    await expect(rail.getByText("Same name")).toBeVisible();

    // R-112: a picked type narrows the card to it, and says so by name.
    await page.getByRole("radio", { name: "Jacket" }).check();
    await expect(
      rail.getByRole("heading", {
        name: "Already in your closet · Top · Jacket",
      }),
    ).toBeVisible();
    await expect(rail.getByText(`Patagonia ${jacket.name}`)).toBeVisible();
    await page.getByRole("radio", { name: "Half-zip" }).check();
    await expect(rail.getByText("No half-zips yet.")).toBeVisible();

    // Round 28 #13: no photo is the hatch; a retirement reads by month and
    // year; SAME NAME and RETIRED are ink, not a verdict's hue. Read on
    // this spec's own row: the journey's retired shoes may be there too.
    await page.getByLabel("Category").selectOption("shoes");
    await expect(
      rail.getByRole("heading", { name: "Already in your closet · Shoes" }),
    ).toBeVisible();
    const retired = rail
      .getByRole("listitem")
      .filter({ hasText: `Nike ${shoe.name}` });
    await expect(retired.getByText("Retired", { exact: true })).toBeVisible();
    await expect(
      retired.getByText(/^0 runs · Retired [A-Z][a-z]{2} \d{4}$/u),
    ).toBeVisible();
    await expect(
      retired.locator("[data-part='thumb'][data-state='no-photo']"),
    ).toBeVisible();
  } finally {
    await removeProductPieces(pieces);
  }
});

test("F · a brand written in katakana saves like any other (R-137)", async ({
  page,
}) => {
  // The identity key used to keep `[a-z0-9]` and nothing else, so "ミズノ"
  // normalized to nothing and the save was refused for having no letters.
  // A letter in any script is a letter now.
  try {
    await page.goto("/closet/new");
    await hydrated(page);
    await page.getByLabel("Brand").fill("ミズノ");
    await page.getByLabel("Model / name").fill("ウエーブライダー 28");
    await page.getByLabel("Category").selectOption("shoes");
    await page.getByRole("button", { name: "Add to closet" }).click();
    await expect(
      page.getByRole("heading", {
        level: 1,
        name: "ミズノ ウエーブライダー 28",
      }),
    ).toBeVisible();
    await expect(
      page.getByText("Brand name must contain at least one letter or digit."),
    ).toHaveCount(0);
  } finally {
    await removeItems(await itemsNamed("ウエーブライダー 28"));
  }
});
