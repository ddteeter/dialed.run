/**
 * Covers: C (the closet, round 22 ruling 16), F (add a garment, ruling
 * 17), Y (garment detail, round 22 `#y`: the photo well, Remove, the
 * retire confirm), §AG (what a garment is made of), §AH (colour as a
 * constraint) — one journey, one video.
 *
 * Exactly one test() per demo spec. A second test here would record a
 * second video beside the one the reviewer is meant to watch; standalone
 * assertions belong in a sibling *.spec.ts.
 *
 * The journey: an empty closet that says so and offers the dashed tile;
 * two garments added with real brand + product-name identity (product
 * identity is the app's differentiator — a generic "top" is not what this
 * screen is for), the second with its photo taken in F's well; detail in
 * round 22's order, the photo removed; then one retired through the
 * confirm sheet, landing on the closet where it is still there, last and
 * marked (CLAUDE.md: retire, don't delete).
 *
 * Round 11's colour rides on the second piece, because that is where it
 * lives on screen: the fifth attribute inside F's already-collapsed group,
 * then the exact shade behind it. Round 10's composition rides on the same
 * piece's detail page — it belongs to the *product*, written by enrichment
 * reading a brand's page, so the demo seeds the product row the save
 * created rather than pretending a runner typed it.
 */
import { eq } from "drizzle-orm";

import { products } from "../../src/db/schema-core";
import { storageStateFor } from "../support/accounts";
import { bar } from "../support/bars";
import { expect, scene, test } from "../support/demo";
import { withLocalDb } from "../support/local-db";

// Signed in already: the account is created by the `demo-setup` project, so
// this video opens on the closet rather than on a signup form.
test.use({ storageState: storageStateFor("closet") });

/** Layout stamps html[data-hydrated] once React attaches; driving
 *  controlled inputs before that races hydration's state reset. */
async function hydrated(page: import("@playwright/test").Page): Promise<void> {
  await page
    .locator('html[data-hydrated="true"]')
    .waitFor({ state: "attached" });
}

/**
 * A real 1x1 PNG — small enough to keep the recording quick, and a genuine
 * decodable image, since the closet's photo path decodes and resizes it.
 */
const PNG_1X1 = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
  "base64",
);

test("add garments with product identity -> detail in round 22's order -> retire through the confirm", async ({
  page,
}, testInfo) => {
  // Generous, because recording pace is not a latency budget. `scene()`
  // holds a beat at each boundary and slowMo paces the actions between
  // them (D-58), so a recorded run is minutes where CI's is seconds — and
  // the first paced run of a session also pays Vite's on-demand compile of
  // whatever a real submit reaches. A timeout here is for catching a hang.
  testInfo.setTimeout(150_000);
  await page.goto("/closet");
  await hydrated(page);

  // Ruling 16: the statement, one line, and the dashed tile — the only
  // way in, because adding is the grid's tile and never a bar action.
  await scene(page, "C · empty: a statement, one line, the dashed tile");
  await expect(
    page.getByRole("heading", { name: /Nothing in here yet/ }),
  ).toBeVisible();
  await expect(
    page.getByText("Add what you run in most. Three pieces is enough to start."),
  ).toBeVisible();

  // First piece: real product identity, not a generic placeholder — brand
  // autocomplete + model name lead, per screen F.
  await scene(page, "F · identity first — and no product-link field (AC2b)");
  await page.getByRole("link", { name: "Add garment" }).click();
  await hydrated(page);
  await expect(page.getByLabel("Product link")).toHaveCount(0);
  await page.getByLabel("Brand").fill("Nike");
  await page.getByLabel("Model / name").fill("Pegasus 41");
  await page.getByLabel("Category").selectOption("shoes");
  await page.getByLabel("Water resistant").check();
  await page.getByRole("button", { name: "Add to closet" }).click();
  await expect(
    page.getByRole("heading", { name: "Nike Pegasus 41" }),
  ).toBeVisible();
  // No photo, so no well: "adding one is Edit's job".
  await expect(page.locator("[data-part='photo-well']")).toHaveCount(0);

  // Second piece, a different category, same identity-first discipline.
  await bar(page).getByRole("link", { name: "Closet" }).click();
  await hydrated(page);
  await scene(page, "A second piece, another category, same discipline");
  await page.getByRole("link", { name: "Add garment" }).click();
  await hydrated(page);
  await page.getByLabel("Brand").fill("Patagonia");
  await page.getByLabel("Model / name").fill("Houdini Jacket");
  await page.getByLabel("Category").selectOption("top");
  await page.getByLabel("Layer").selectOption("outer");
  await page.getByLabel("Weight").selectOption("light");
  await page.getByLabel("Wind resistant").check();

  // §AH. Colour is the fifth attribute, inside the group that is already
  // open — so the happy path's tap count does not move. Chips are words,
  // never swatches.
  await scene(page, "§AH · colour is words, and it is the fifth attribute");
  await page.getByRole("radio", { name: "Reflective trim" }).check();
  await page.getByRole("radio", { name: "Black" }).check();

  // Level 2, and unreachable without level 1: the affordance does not
  // exist until a name has been chosen.
  await scene(page, "§AH · the exact shade, reached from a chosen name");
  await page.getByRole("button", { name: "Exact shade" }).click();
  await page.getByLabel("Hex").fill("#1F2A44");
  await page.getByRole("button", { name: "Use this" }).click();
  await expect(
    page.getByRole("button", { name: "Exact shade · #1f2a44" }),
  ).toBeVisible();

  // Ruling 17: Size, Colorway, then the photo well, then the save. The
  // photo goes through W3's blur and is held, previewed in the well, until
  // the save has made the row it belongs to.
  await scene(page, "F · the photo well, last before the save");
  const well = page.locator("[data-part='photo-well']");
  await expect(well).toHaveAttribute("data-state", "empty");
  await page.setInputFiles('[data-part="photo-well"] input[type="file"]', {
    name: "houdini.png",
    mimeType: "image/png",
    buffer: PNG_1X1,
  });
  await expect(well).toHaveAttribute("data-state", "filled", {
    timeout: 20_000,
  });
  await expect(well.locator('img[src^="blob:"]')).toBeVisible();

  await page.getByRole("button", { name: "Add to closet" }).click();
  await expect(
    page.getByRole("heading", { name: "Patagonia Houdini Jacket" }),
  ).toBeVisible();

  // Round 22's Y: identity (the colourway as words, the chosen shade as
  // the square beside it), then the photo in its well, stats, composition.
  await scene(page, "Y · identity, then the photo — the well is the preview");
  await expect(page.locator("[data-part='identity']")).toContainText("black");
  await expect(
    page.locator("[data-part='identity'] [data-content]"),
  ).toBeVisible();
  await expect(well).toHaveAttribute("data-state", "filled");
  await expect(well.locator('img[src^="/closet/photo/"]')).toBeVisible();
  await expect(page.getByText("Replace")).toBeVisible();
  await expect(page.getByText("light · wind resistant · reflective trim")).toBeVisible();

  // §AG. Composition belongs to the product, not to the runner's copy —
  // enrichment writes it from a brand's page, so the demo writes the row
  // enrichment would have. Seeded through Drizzle and the real schema.
  await withLocalDb(async ({ core }) => {
    await core
      .update(products)
      .set({
        fabricComposition: "100% nylon, GORE-TEX",
        fabricParts: JSON.stringify([
          { part: "Body", materials: [{ material: "nylon", pct: 100 }] },
          {
            part: "Underarm",
            materials: [
              { material: "polyester", pct: 87 },
              { material: "elastane", pct: 13 },
            ],
          },
        ]),
      })
      .where(eq(products.name, "Houdini Jacket"));
  });

  await scene(page, "§AG · made of — the brand's words, on detail alone");
  await page.reload();
  await hydrated(page);
  await expect(page.getByText("Made of")).toBeVisible();
  await expect(page.getByText("Body")).toBeVisible();
  await expect(page.getByText("87% polyester · 13% elastane")).toBeVisible();
  await expect(page.getByText("As labelled by Patagonia")).toBeVisible();

  // Round 22's well: Remove takes the photo away — row and storage — and
  // with no photo, detail has no well at all.
  await scene(page, "Y · Remove: the photo goes, and so does the well");
  await page.getByRole("button", { name: "Remove" }).click();
  await expect(page.locator("[data-part='photo-well']")).toHaveCount(0);

  // C at desk: one flat grid, the count on the left. §AG rule 03: the
  // closet is for finding, so no composition on the grid.
  await scene(page, "C · one flat grid, and the count says how many");
  await bar(page).getByRole("link", { name: "Closet" }).click();
  await hydrated(page);
  await expect(page.getByRole("heading", { name: "2 pieces" })).toBeVisible();
  await expect(page.getByText("Made of")).toHaveCount(0);
  await expect(
    page.getByRole("link", { name: /Nike Pegasus 41/ }),
  ).toBeVisible();
  await expect(
    page.getByRole("link", { name: /Patagonia Houdini Jacket/ }),
  ).toBeVisible();

  // Into a piece and back out of it (task 117). Browser back rather than a
  // link, because that is the gesture the reversal is read from.
  await scene(page, "Back leaves the way it came");
  await page.getByRole("link", { name: /Nike Pegasus 41/ }).click();
  await hydrated(page);
  await expect(
    page.getByRole("heading", { name: /Nike Pegasus 41/ }),
  ).toBeVisible();
  await page.goBack();
  await hydrated(page);
  await expect(page.getByRole("heading", { name: "2 pieces" })).toBeVisible();

  // Retire, don't delete — and ask first. The sheet names the piece and
  // what it keeps; focus lands on Keep it.
  await scene(page, "Y · Retire asks first, and focus lands on Keep it");
  await page.getByRole("link", { name: /Nike Pegasus 41/ }).click();
  await hydrated(page);
  await page
    .locator("[data-part='actions']")
    .getByRole("button", { name: "Retire" })
    .click();
  const sheet = page.locator("[data-part='sheet']");
  await expect(
    sheet.getByRole("heading", { name: "Retire the Pegasus 41?" }),
  ).toBeVisible();
  await expect(sheet.getByRole("button", { name: "Keep it" })).toBeFocused();

  // Retiring lands back on the closet with retired pieces shown, so the
  // shoes are visibly still there — last, and marked in the kicker.
  await scene(page, "Retired: still here, sorted last, [RETIRED] in the kicker");
  await sheet.getByRole("button", { name: "Retire" }).click();
  await expect(
    page.getByRole("link", { name: /Nike Pegasus 41/ }),
  ).toBeVisible();
  await expect(page.getByText("[Retired]", { exact: true })).toBeVisible();
  const toggle = page.getByRole("switch", { name: "Show retired" });
  await expect(toggle).toBeChecked();

  // The switch off: the retired tile collapses its own height rather than
  // blinking out, and what remains reflows (task 114). The demo project
  // records with `reducedMotion: "no-preference"` on purpose.
  await scene(page, "The switch off: the tile collapses, the rest reflow");
  await toggle.uncheck();
  await expect(page.getByRole("link", { name: /Nike Pegasus 41/ })).toHaveCount(
    0,
  );
  await expect(page.getByRole("heading", { name: "1 piece" })).toBeVisible();

  // And back — the tiles already there travel, the one arriving does not
  // re-enter: "the garments did not go anywhere".
  await scene(page, "And back — they travel, they do not reappear");
  await toggle.check();
  await expect(
    page.getByRole("link", { name: /Nike Pegasus 41/ }),
  ).toBeVisible();
});
