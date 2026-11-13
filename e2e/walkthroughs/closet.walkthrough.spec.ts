/**
 * Walkthrough · the closet (design 180, step 5): a runner's gear, as real
 * products, and what happens when a piece wears out. A product story,
 * narrated, recorded at desk and phone; the closet journey
 * (`e2e/closet/closet.journey.spec.ts`) carries the edge cases.
 */
import { bar } from "../support/bars";
import { hydrated, scene, typeSlowly } from "../support/demo";
import { expect, test } from "../support/walkthrough";

test("the closet: real products, a record per piece, retire not delete", async ({
  page,
}, testInfo) => {
  // Recording pace is not a latency budget; this catches a hang.
  testInfo.setTimeout(400_000);

  await page.goto("/closet");
  await hydrated(page);
  await expect(
    page.getByRole("heading", { name: /Nothing in here yet/ }),
  ).toBeVisible();
  await scene(page, "The Closet · empty, and it says what to do", {
    say: "This is the Closet: the gear you run in. A new runner's is empty, and instead of a blank page it says what to do first: add what you run in most.",
  });
  await scene(page, "Adding a piece", {
    say: "So let's add the shoes I run in most. I'll tap Add a piece.",
  });

  await page.getByRole("link", { name: "Add a piece" }).click();
  await hydrated(page);
  await expect(page.getByLabel("Category")).toBeVisible();
  await expect(page.getByLabel("Brand")).toBeVisible();
  await expect(page.getByLabel("Model / name")).toBeVisible();
  await scene(page, "A piece is a real product · brand and model", {
    say: "Every piece is a real product, with a brand and a model, not just shoes. That is what lets dialed.run learn how this exact shoe works for you.",
  });
  await scene(page, "Shoes · Nike Pegasus 41", {
    say: "I'll pick shoes as the category, and type the brand, Nike, and the model, Pegasus 41.",
  });
  await page.getByLabel("Category").selectOption("shoes");
  await typeSlowly(page.getByLabel("Brand"), "Nike");
  await typeSlowly(page.getByLabel("Model / name"), "Pegasus 41");
  await page.getByRole("button", { name: "Add to closet" }).click();
  await expect(
    page.getByRole("heading", { name: "Nike Pegasus 41" }),
  ).toBeVisible();
  await scene(page, "Saved · under its own name", {
    say: "It's saved under its own name, Nike Pegasus 41, rather than as a pair of shoes.",
  });

  await scene(page, "A second piece · a jacket", {
    say: "Now a jacket. I'll go back to the Closet and add another piece, this time a top.",
  });
  await bar(page).getByRole("link", { name: "Closet" }).click();
  await hydrated(page);
  await page.getByRole("link", { name: "Add a piece" }).click();
  await hydrated(page);
  await page.getByLabel("Category").selectOption("top");
  await expect(page.getByRole("radio", { name: "Jacket" })).toBeVisible();
  await expect(page.getByLabel("Layer")).toBeVisible();
  await expect(page.getByLabel("Wind resistant")).toBeVisible();
  await scene(page, "A top asks more · shape, layer, what it keeps out", {
    say: "A top asks a little more than shoes: what shape it is, which layer it is, and what it keeps out.",
  });
  await scene(page, "Jacket · Patagonia Houdini", {
    say: "I'll mark it as a jacket, and type the brand, Patagonia, and the model, Houdini Jacket.",
  });
  await page.getByRole("radio", { name: "Jacket" }).check();
  await typeSlowly(page.getByLabel("Brand"), "Patagonia");
  await typeSlowly(page.getByLabel("Model / name"), "Houdini Jacket");
  // Below the fold at both widths: show the fields before naming them.
  await page.getByLabel("Wind resistant").scrollIntoViewIfNeeded();
  await scene(page, "Outer layer · wind resistant", {
    say: "It goes over everything, so it's the outer layer. And it's a shell that keeps the gusts out, so I'll tick wind resistant. That's the detail that matters on a cold, gusty morning.",
  });
  await page.getByLabel("Layer").selectOption("outer");
  await page.getByLabel("Wind resistant").check();
  await page.getByRole("button", { name: "Add to closet" }).click();
  await expect(
    page.getByRole("heading", { name: "Patagonia Houdini Jacket" }),
  ).toBeVisible();

  await bar(page).getByRole("link", { name: "Closet" }).click();
  await hydrated(page);
  await expect(page.getByRole("heading", { name: "2 pieces" })).toBeVisible();
  const pegasus = page.getByRole("link", { name: /Nike Pegasus 41/ });
  await expect(pegasus.locator("[data-part='tile-record']")).toHaveText(
    "No runs yet",
    { ignoreCase: true },
  );
  await scene(page, "Two pieces · each a tile", {
    say: "Back in the Closet, there are two pieces now, each one a tile.",
  });
  await scene(page, "Each tile · the piece and its record", {
    say: "Each tile is the piece and its record. Nothing yet: it fills in as you log runs in it, and the verdicts say what weather it works in.",
  });

  await scene(page, "Say the shoe wears out", {
    say: "Now say the Pegasus has done its miles. I'll open it, and choose Retire.",
  });
  await pegasus.click();
  await hydrated(page);
  await page
    .locator("[data-part='actions']")
    .getByRole("button", { name: "Retire" })
    .click();
  const sheet = page.locator("[data-part='sheet']");
  await expect(
    page
      .locator("dialog[open]")
      .getByRole("heading", { name: "Retire the Pegasus 41?" }),
  ).toBeVisible();
  await expect(sheet).toContainText("It leaves the closet and the picker.");
  await expect(sheet).toContainText("You can bring it back.");
  await scene(page, "Worn out? Retire it · never delete it", {
    say: "When a shoe wears out, you retire it. You don't delete it, because whatever runs and verdicts it has are part of your history.",
  });
  await scene(page, "Out of the picker · and it can come back", {
    say: "The sheet says what retiring does: it leaves the kit picker, so you won't pick a dead shoe for a run, and you can bring it back. I'll confirm.",
  });
  await sheet.getByRole("button", { name: "Retire" }).click();
  await expect(page.getByText("[Retired]", { exact: true })).toBeVisible();
  const retiredSwitch = page.getByRole("switch", { name: "Show retired (1)" });
  await expect(retiredSwitch).toBeChecked();
  // Sorted last is below the fold on a phone: show it before saying so.
  await page
    .getByRole("link", { name: /Nike Pegasus 41/ })
    .scrollIntoViewIfNeeded();
  await expect(
    page.locator("[data-part='grid'] [data-part='tile-name']").last(),
  ).toContainText("Pegasus 41");
  await scene(page, "Still here · marked, and sorted last", {
    say: "It stays in the Closet, marked retired and sorted last.",
  });
  await retiredSwitch.scrollIntoViewIfNeeded();
  await scene(page, "One switch · show retired", {
    say: "And this one switch, show retired, tucks them away whenever you'd rather not see them.",
  });
});
