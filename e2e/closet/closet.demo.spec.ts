/**
 * Covers: C (the closet), F (add a garment), E (garment detail's photo
 * well, round 22), §AG (what a garment is made
 * of), §AH (colour as a constraint) — one journey, one video.
 *
 * Exactly one test() per demo spec. A second test here would record a
 * second video beside the one the reviewer is meant to watch; standalone
 * assertions belong in a sibling *.spec.ts.
 *
 * The journey: sign up, add two garments with real brand + product-name
 * identity (product identity is the app's differentiator — a generic "top"
 * is not what this screen is for), browse the categorized closet, then
 * retire one item and confirm it moves behind the retired toggle instead
 * of disappearing (CLAUDE.md: retire, don't delete).
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

test("add garments with product identity -> browse the closet -> retire, don't delete", async ({
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
  await scene(page, "C · an empty closet says so plainly");
  await expect(page.getByText("Nothing in here yet")).toBeVisible();

  // First piece: real product identity, not a generic placeholder — brand
  // autocomplete + model name lead, per screen F.
  await scene(page, "F · identity first — a brand and a model, not a top");
  await page.getByRole("link", { name: "Add a piece" }).click();
  await page.getByLabel("Brand").fill("Nike");
  await page.getByLabel("Model / name").fill("Pegasus 41");
  await page.getByLabel("Category").selectOption("shoes");
  await page.getByLabel("Water resistant").check();
  await page.getByRole("button", { name: "Add to closet" }).click();
  await expect(
    page.getByRole("heading", { name: "Nike Pegasus 41" }),
  ).toBeVisible();

  // Second piece, a different category, same identity-first discipline.
  await bar(page).getByRole("link", { name: "Closet" }).click();
  await scene(page, "A second piece, another category, same discipline");
  await page.getByRole("link", { name: "Add", exact: true }).click();
  await page.getByLabel("Brand").fill("Patagonia");
  await page.getByLabel("Model / name").fill("Houdini Jacket");
  await page.getByLabel("Category").selectOption("top");
  await page.getByLabel("Layer").selectOption("outer");
  await page.getByLabel("Weight").selectOption("light");
  await page.getByLabel("Wind resistant").check();

  // §AH. Colour is the fifth attribute, inside the group that is already
  // open — so the happy path's tap count does not move. Chips are words,
  // never swatches: thirteen swatches would be thirteen accents in one
  // viewport, and hue already means verdict everywhere in this app.
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

  await page.getByRole("button", { name: "Add to closet" }).click();
  await expect(
    page.getByRole("heading", { name: "Patagonia Houdini Jacket" }),
  ).toBeVisible();

  // §AH rule 08: the name on the identity line, beside the colourway, as
  // words. No swatch here either.
  await scene(page, "§AH · the name on the identity line, never a swatch");
  await expect(page.getByText(/reflective trim · black/)).toBeVisible();

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

  // Round 22, item 8: the photo sits in the well. It passes through W3's
  // blur first — garment photos used to skip it (D-102) — and once stored
  // the well IS the preview, with Replace under it, never an image above a
  // well that still says "Add a photo".
  await scene(page, "The photo goes through the blur, then sits in the well");
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
  await expect(well.locator('img[src^="/closet/photo/"]')).toBeVisible();
  await expect(page.getByText("Replace")).toBeVisible();
  await expect(page.getByText("Add a photo")).toHaveCount(0);

  // Browse the closet: both pieces show real brand + model, grouped by
  // the derived UI group (an "outer" layer groups on its own, ahead of
  // its base category).
  await scene(page, "C · grouped by derived group — outer sits above top");
  await bar(page).getByRole("link", { name: "Closet" }).click();
  // §AG rule 03: the closet is for finding. No composition on the grid.
  await expect(page.getByText("Made of")).toHaveCount(0);
  await expect(
    page.getByRole("heading", { name: "Shoes", level: 2 }),
  ).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "Outer", level: 2 }),
  ).toBeVisible();
  await expect(
    page.getByRole("link", { name: /Nike Pegasus 41/ }),
  ).toBeVisible();
  await expect(
    page.getByRole("link", { name: /Patagonia Houdini Jacket/ }),
  ).toBeVisible();

  // Into a piece and back out of it (task 117). `NAV` types
  // Closet -> Garment detail a `push`, and "back reverses both", so this
  // records the same move running the other way — which the Closet tab
  // link would not, because a tab is a `cut`.
  //
  // Browser back rather than a link, because that is the gesture the
  // reversal is read from: the router compares history indexes, and a
  // link to the same place is a forward navigation to it.
  await scene(page, "Back leaves the way it came");
  await page.getByRole("link", { name: /Nike Pegasus 41/ }).click();
  await hydrated(page);
  await expect(
    page.getByRole("heading", { name: /Nike Pegasus 41/ }),
  ).toBeVisible();
  await page.goBack();
  await hydrated(page);
  await expect(
    page.getByRole("heading", { name: "Shoes", level: 2 }),
  ).toBeVisible();

  // Retire, don't delete. Retiring lands back on the closet with retired
  // items already shown, so the shoes are visibly still there and marked —
  // the point of the product rule, and the answer to "where did it go?".
  await scene(page, "Retire, don't delete — still here, and marked");
  await page.getByRole("link", { name: /Nike Pegasus 41/ }).click();
  await page.getByRole("button", { name: "Retire" }).click();
  await expect(
    page.getByRole("link", { name: /Nike Pegasus 41/ }),
  ).toBeVisible();
  await expect(page.getByText("[Retired]", { exact: true })).toBeVisible();

  // And they are genuinely retired: hiding them takes the shoes out of the
  // default view, where the jacket stays.
  //
  // This is also where two of the doctrine's moves are on film (task 114):
  // the retired row collapses its own height rather than blinking out —
  // "collapse says removed from the list; a fade says still there, just
  // hidden" — and what remains reflows into the space instead of fading
  // and re-entering. The demo project records with `reducedMotion:
  // "no-preference"` on purpose, so both are visible at recorded pace.
  await scene(page, "Hiding it: the row collapses, the rest reflow");
  await page.getByRole("button", { name: "Hide retired (1)" }).click();
  await expect(page.getByRole("link", { name: /Nike Pegasus 41/ })).toHaveCount(
    0,
  );
  await expect(
    page.getByRole("link", { name: /Patagonia Houdini Jacket/ }),
  ).toBeVisible();

  // And back, which is the same move the other way: the rows that were
  // already there travel to their new places, and the one arriving does
  // not re-enter — "the garments did not go anywhere".
  await scene(page, "And back — they travel, they do not reappear");
  await page.getByRole("button", { name: "Show retired (1)" }).click();
  await expect(
    page.getByRole("link", { name: /Nike Pegasus 41/ }),
  ).toBeVisible();
});
