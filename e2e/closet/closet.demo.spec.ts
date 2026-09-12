/**
 * Covers: C (the closet), F (add a garment) — one journey, one video.
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
 */
import { storageStateFor } from "../support/accounts";
import { expect, test } from "../support/demo";

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

test("add garments with product identity -> browse the closet -> retire, don't delete", async ({
  page,
}, testInfo) => {
  // The demo project paces every action with slowMo 1800 (raised 450 -> 900
  // -> 1800 on review feedback). This journey is ~30 actions, so pacing
  // alone is ~54s before any real work — well past Playwright's 30s
  // default. The spec predates the 900 -> 1800 raise and never got the
  // per-spec bump the config tells you to add; it started failing the
  // moment this branch merged main. See e2e/run-logging for the same fix.
  testInfo.setTimeout(150_000);
  await page.goto("/closet");
  await hydrated(page);
  await expect(page.getByText("Nothing in here yet")).toBeVisible();

  // First piece: real product identity, not a generic placeholder — brand
  // autocomplete + model name lead, per screen F.
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
  await page.getByRole("link", { name: "Closet" }).click();
  await page.getByRole("link", { name: "Add", exact: true }).click();
  await page.getByLabel("Brand").fill("Patagonia");
  await page.getByLabel("Model / name").fill("Houdini Jacket");
  await page.getByLabel("Category").selectOption("top");
  await page.getByLabel("Layer").selectOption("outer");
  await page.getByLabel("Weight").selectOption("light");
  await page.getByLabel("Wind resistant").check();
  await page.getByRole("button", { name: "Add to closet" }).click();
  await expect(
    page.getByRole("heading", { name: "Patagonia Houdini Jacket" }),
  ).toBeVisible();

  // Browse the closet: both pieces show real brand + model, grouped by
  // the derived UI group (an "outer" layer groups on its own, ahead of
  // its base category).
  await page.getByRole("link", { name: "Closet" }).click();
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

  // Retire, don't delete. Retiring lands back on the closet with retired
  // items already shown, so the shoes are visibly still there and marked —
  // the point of the product rule, and the answer to "where did it go?".
  await page.getByRole("link", { name: /Nike Pegasus 41/ }).click();
  await page.getByRole("button", { name: "Retire" }).click();
  await expect(
    page.getByRole("link", { name: /Nike Pegasus 41/ }),
  ).toBeVisible();
  await expect(page.getByText("[Retired]", { exact: true })).toBeVisible();

  // And they are genuinely retired: hiding them takes the shoes out of the
  // default view, where the jacket stays.
  await page.getByRole("button", { name: "Hide retired (1)" }).click();
  await expect(
    page.getByRole("link", { name: /Nike Pegasus 41/ }),
  ).toHaveCount(0);
  await expect(
    page.getByRole("link", { name: /Patagonia Houdini Jacket/ }),
  ).toBeVisible();
});
