/**
 * Covers: C (the closet, round 22 ruling 16), F (add a garment, ruling
 * 17), Y (garment detail, round 22 `#y`: the photo well, Remove, the
 * retire confirm), §AH (colour as a constraint), round 26 #9 (Show retired
 * (N)), round 28 #5 (W3 confirm: Check the blur, Use this photo, as the
 * closet's sheet), D-75 (F's TYPE), round 43 #93 and #95 (F's product
 * link, and E's shop page), R-94 (C's rail: GROUP, WORKS AT, COVERAGE,
 * and the phone's chips, design 174), and the tile's photo, record and
 * range with the rail's empty groups left out (round 27 #31b, round 47
 * #112b and #115-117) — one journey, one video.
 *
 * Exactly one test() per journey spec. A second test here would record a
 * second video beside the one the reviewer is meant to watch; standalone
 * assertions belong in a sibling *.spec.ts — `closet.spec.ts` holds F's
 * order and ▾, its refused links, Pick another, §AG's composition, F at
 * the desk, a photo lost to a dropped connection, deleting a piece with
 * runs, and a brand in any script.
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
 * then the exact shade behind it.
 */
import { storageStateFor } from "../support/accounts";
import { bar } from "../support/bars";
import { expect, hydrated, scene, test } from "../support/demo";
import { PNG_1X1 } from "./closet-support";

// Signed in already: the account is created by the `demo-setup` project, so
// this video opens on the closet rather than on a signup form.
test.use({ storageState: storageStateFor("closet") });

test("add garments with product identity -> detail in round 22's order -> retire through the confirm", async ({
  page,
}, testInfo) => {
  // Generous, because recording pace is not a latency budget. `scene()`
  // holds a beat at each boundary and slowMo paces the actions between
  // them (R-58), so a recorded run is minutes where CI's is seconds — and
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
    page.getByText(
      "Add what you run in most. Three pieces is enough to start.",
    ),
  ).toBeVisible();

  // First piece: real product identity, not a generic placeholder — brand
  // autocomplete + model name lead, per screen F.
  await scene(
    page,
    "F · Category and Type lead, then Brand, Name and the product link",
  );
  await page.getByRole("link", { name: "Add garment" }).click();
  await hydrated(page);
  // The click is a client-side navigation, so the hydrated flag is
  // already set from the closet page: wait for F itself before reading it.
  const category = page.getByLabel("Category");
  await expect(category).toBeVisible();
  await page.getByLabel("Category").selectOption("shoes");
  await page.getByLabel("Brand").fill("Nike");
  await page.getByLabel("Model / name").fill("Pegasus 41");
  await page.getByLabel("Water resistant").check();
  await page.getByRole("button", { name: "Add to closet" }).click();
  await expect(
    page.getByRole("heading", { name: "Nike Pegasus 41" }),
  ).toBeVisible();
  // No photo, so no well: "adding one is Edit's job".
  await expect(page.locator("[data-part='photo-well']")).toHaveCount(0);

  // Second piece, a different category, in the same order.
  await bar(page).getByRole("link", { name: "Closet" }).click();
  await hydrated(page);
  await scene(page, "A second piece, another category, same discipline");
  await page.getByRole("link", { name: "Add garment" }).click();
  await hydrated(page);
  await page.getByLabel("Category").selectOption("top");
  // D-75: round 26's TYPE, under the category, the contract's types.
  await scene(page, "F · TYPE, under the category: what shape it is");
  await page.getByRole("radio", { name: "Jacket" }).check();
  await page.getByLabel("Brand").fill("Patagonia");
  await page.getByLabel("Model / name").fill("Houdini Jacket");
  // Round 43 #93: a link pasted without its scheme gets https:// on save.
  await scene(page, "F · the product link, after what it is");
  const link = page.getByLabel(/Product link/);
  await link.fill("patagonia.com/houdini");
  await link.blur();
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
  // Round 28 #5: W3 stays open once auto-blur paints, and nothing is
  // attached until Use this photo.
  await scene(
    page,
    "W3 · check the blur, in a sheet: it waits for your choice",
  );
  await expect(
    page.getByRole("dialog", { name: "Check the blur" }),
  ).toBeVisible();
  const use = page.getByRole("button", { name: "Use this photo" });
  await expect(
    page.getByRole("heading", { name: "Check the blur" }),
  ).toBeFocused();
  await expect(use).not.toHaveAttribute("aria-disabled", "true", {
    timeout: 20_000,
  });
  await expect(well).toHaveAttribute("data-state", "uploading");
  await use.click();
  await expect(
    page.getByRole("heading", { name: "Check the blur" }),
  ).toHaveCount(0);
  await expect(
    page.getByRole("dialog", { name: "Check the blur" }),
  ).toBeHidden();
  await expect(well).toHaveAttribute("data-state", "filled", {
    timeout: 20_000,
  });
  const preview = well.locator('img[src^="blob:"]');
  await expect(preview).toBeVisible();
  // Use this photo closes W3 back onto the well — its Replace, now.
  await expect(
    page.locator("[data-part='well-actions'] input[type='file']"),
  ).toBeFocused();

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
  await expect(
    page.getByText("lightweight · wind resistant · reflective trim"),
  ).toBeVisible();
  // Round 43 #95: the shop page under the name, its domain beside it.
  const shopPage = page.getByRole("link", { name: "Shop page" });
  await expect(shopPage).toHaveAttribute(
    "href",
    "https://patagonia.com/houdini",
  );
  await expect(
    page.locator("[data-part='shop-page']").getByText("patagonia.com"),
  ).toBeVisible();
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

  // Board C's tile (round 27 #31b, round 47 #115-117): the photo's place
  // at 4:5, hatched while there is none, then the name, the record and
  // the bracketed range. Never worn: NO RUNS YET, and no mileage.
  await scene(page, "C · each tile: its photo's place, the name, the record");
  const pegasus = page.getByRole("link", { name: /Nike Pegasus 41/ });
  await expect(pegasus.locator("[data-part='tile-photo']")).toHaveAttribute(
    "data-state",
    "no-photo",
  );
  await expect(pegasus.locator("[data-part='tile-record']")).toHaveText(
    "No runs yet",
    { ignoreCase: true },
  );
  await expect(pegasus.locator("[data-part='tile-range']")).toHaveText(
    /^\[[^\]]+\]$/u,
  );

  // ---- R-94 · C's rail: GROUP, WORKS AT, COVERAGE --------------------------
  // Round 16's three groups beside the grid at desk, whole. Every value is
  // a link to the closet with the search changed, and the counts are the
  // closet's, not narrowed by the other groups.
  await scene(page, "C · the rail: GROUP with counts, WORKS AT, COVERAGE");
  const filters = page.locator("nav[data-part='rail']");
  await expect(filters.getByRole("link", { name: /^All/ })).toHaveText("All 2");
  await expect(filters.getByRole("link", { name: /^All/ })).toHaveAttribute(
    "aria-current",
    "page",
  );
  await expect(filters.getByRole("button", { name: /^Untested/ })).toHaveText(
    /Untested\s*2/u,
  );
  // Round 47 #112b: a group the closet holds nothing in is left out, and
  // All always shows. Two pieces, shoes and an outer: two groups.
  await expect(filters.getByRole("link", { name: /^Tops/ })).toHaveCount(0);
  await expect(filters.getByRole("link", { name: /^Outer/ })).toHaveText(
    "Outer 1",
  );

  await scene(page, "C · GROUP narrows the grid, and the heading names it");
  await filters.getByRole("link", { name: /^Shoes/ }).click();
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("1 · Shoes");
  await expect(
    page.getByRole("link", { name: /Nike Pegasus 41/ }),
  ).toBeVisible();
  await expect(
    page.getByRole("link", { name: /Patagonia Houdini Jacket/ }),
  ).toHaveCount(0);
  await expect(filters.getByRole("link", { name: /^All/ })).toHaveText("All 2");
  await filters.getByRole("link", { name: /^All/ }).click();
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("2 pieces");

  // WORKS AT in the runner's unit, and the bar is the control (round 46
  // #109h); the URL holds Celsius. End on the lower thumb: from the
  // closet's warmest end up.
  await scene(page, "C · WORKS AT: the bar, in your unit");
  const lowest = filters.getByRole("slider", { name: "Lowest" });
  const warmest = (await lowest.getAttribute("max")) ?? "";
  await lowest.focus();
  await page.keyboard.press("End");
  const filtered = page.locator("[data-part='filtered']");
  await expect(filtered.locator("[aria-hidden='true']")).toHaveText(
    `${warmest}°+`,
  );
  await expect(filtered.locator(".sr-only")).toHaveText(
    `${warmest} degrees and up`,
  );
  await expect(page).toHaveURL(/[?&]from=/u);
  await expect(page).not.toHaveURL(/[?&]unit=/u);
  await expect(filters.getByRole("button", { name: "Apply" })).toHaveCount(0);

  // #109f: Any lets go of the span and puts focus on the label.
  await scene(page, "C · Any: the whole span again, focus on the label");
  await filters.getByRole("button", { name: "Any" }).click();
  await expect(page.locator("[data-part='filtered']")).toHaveCount(0);
  await expect(
    filters.getByRole("heading", { name: "Works at" }),
  ).toBeFocused();

  // #109f: COVERAGE's levels are toggles; pressing the pressed one clears.
  await scene(page, "C · COVERAGE: press a level, press it again to clear");
  const untested = filters.getByRole("button", { name: /^Untested/ });
  await untested.click();
  await expect(untested).toHaveAttribute("aria-pressed", "true");
  await expect(page.locator("[data-part='filtered']")).toHaveText(
    /^Filtered:\s*Untested$/u,
  );
  await untested.click();
  await expect(untested).toHaveAttribute("aria-pressed", "false");
  await expect(page.locator("[data-part='filtered']")).toHaveCount(0);

  // #109d: the line above the grid, and Clear filters puts focus on the
  // count.
  await scene(page, "C · nothing matches: it says so, and Clear filters");
  await filters.getByRole("button", { name: /^Covered/ }).click();
  await expect(
    page.getByText("Nothing in your closet matches these filters."),
  ).toBeVisible();
  await page.getByRole("link", { name: "Clear filters" }).click();
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("2 pieces");
  await expect(page.getByRole("heading", { level: 1 })).toBeFocused();

  // #109b: below 1040, one chip per group reading GROUP · VALUE; a tap
  // opens that group's control under the row, one at a time.
  await scene(page, "C on a phone · a chip per group, one open at a time");
  await page.setViewportSize({ width: 390, height: 844 });
  const chips = page.locator("nav[data-part='chips']");
  await expect(chips).toBeVisible();
  await expect(filters).toBeHidden();
  const worksAtChip = chips.getByRole("button", { name: "Works at · Any" });
  await worksAtChip.click();
  await expect(worksAtChip).toHaveAttribute("aria-expanded", "true");
  await expect(chips.getByRole("slider", { name: "Lowest" })).toBeVisible();
  const groupChip = chips.getByRole("button", { name: "Group · All" });
  await groupChip.click();
  await expect(worksAtChip).toHaveAttribute("aria-expanded", "false");
  await chips.getByRole("link", { name: /^Outer/ }).click();
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("1 · Outer");
  await expect(
    chips.getByRole("button", { name: "Group · Outer" }),
  ).toBeVisible();
  // The group's control stays open under its chip after a pick.
  await chips.getByRole("link", { name: /^All/ }).click();
  await page.setViewportSize({ width: 1280, height: 720 });
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("2 pieces");

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
  await scene(
    page,
    "Retired: still here, sorted last, [RETIRED] in the kicker",
  );
  await sheet.getByRole("button", { name: "Retire" }).click();
  await expect(
    page.getByRole("link", { name: /Nike Pegasus 41/ }),
  ).toBeVisible();
  await expect(page.getByText("[Retired]", { exact: true })).toBeVisible();
  const toggle = page.getByRole("switch", { name: "Show retired (1)" });
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
