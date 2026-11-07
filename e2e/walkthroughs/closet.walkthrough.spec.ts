/**
 * Walkthrough · the closet (design 180, step 5): a runner's gear, as real
 * products, and what happens when a piece wears out. A product story,
 * narrated, recorded at desk and phone; the closet journey
 * (`e2e/closet/closet.demo.spec.ts`) carries the edge cases.
 */
import { bar } from "../support/bars";
import { hydrated, scene } from "../support/demo";
import { expect, test } from "../support/walkthrough";

test("the closet: real products, a record per piece, retire not delete", async ({
  page,
}, testInfo) => {
  // Recording pace is not a latency budget; this catches a hang.
  testInfo.setTimeout(150_000);

  await page.goto("/closet");
  await hydrated(page);
  await expect(
    page.getByRole("heading", { name: /Nothing in here yet/ }),
  ).toBeVisible();
  await scene(page, "The closet · empty, and it says what to do", {
    say: "This is the closet: the gear you run in. A new runner's is empty, and it says what to do first. Add what you run in most.",
  });

  await page.getByRole("link", { name: "Add garment" }).click();
  await hydrated(page);
  await expect(page.getByLabel("Category")).toBeVisible();
  await scene(page, "A piece is a real product · brand and model", {
    say: "Every piece is a real product, with a brand and a model, not just shoes. That is what lets dialed.run learn how this exact shoe works for you.",
  });
  await page.getByLabel("Category").selectOption("shoes");
  await page.getByLabel("Brand").fill("Nike");
  await page.getByLabel("Model / name").fill("Pegasus 41");
  await page.getByRole("button", { name: "Add to closet" }).click();
  await expect(
    page.getByRole("heading", { name: "Nike Pegasus 41" }),
  ).toBeVisible();

  await bar(page).getByRole("link", { name: "Closet" }).click();
  await hydrated(page);
  await page.getByRole("link", { name: "Add garment" }).click();
  await hydrated(page);
  await page.getByLabel("Category").selectOption("top");
  await scene(page, "A jacket · what shape it is, and what it does", {
    say: "A jacket says a little more: what shape it is, which layer it is, and what it keeps out.",
  });
  await page.getByRole("radio", { name: "Jacket" }).check();
  await page.getByLabel("Brand").fill("Patagonia");
  await page.getByLabel("Model / name").fill("Houdini Jacket");
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
  await scene(page, "Each tile · the piece and its record", {
    say: "Each tile is the piece and its record. Nothing yet: the record fills in as you log runs in it, and the verdicts say what weather it works in.",
  });

  await pegasus.click();
  await hydrated(page);
  await page
    .locator("[data-part='actions']")
    .getByRole("button", { name: "Retire" })
    .click();
  const sheet = page.locator("[data-part='sheet']");
  await expect(
    sheet.getByRole("heading", { name: "Retire the Pegasus 41?" }),
  ).toBeVisible();
  await scene(page, "Worn out? Retire it · never delete it", {
    say: "When a shoe wears out, you retire it. You don't delete it, because its runs and verdicts are still part of your history.",
  });
  await sheet.getByRole("button", { name: "Retire" }).click();
  await expect(page.getByText("[Retired]", { exact: true })).toBeVisible();
  await expect(
    page.getByRole("switch", { name: "Show retired (1)" }),
  ).toBeChecked();
  // Sorted last is below the fold on a phone: show it before saying so.
  await page
    .getByRole("link", { name: /Nike Pegasus 41/ })
    .scrollIntoViewIfNeeded();
  await scene(page, "Still here · marked, and sorted last", {
    say: "It stays in the closet, marked retired and sorted last, and one switch hides it.",
  });
});
