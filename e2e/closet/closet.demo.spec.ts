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
import { expect, test } from "../support/demo";

/** Layout stamps html[data-hydrated] once React attaches; driving
 *  controlled inputs before that races hydration's state reset. */
async function hydrated(page: import("@playwright/test").Page): Promise<void> {
  await page
    .locator('html[data-hydrated="true"]')
    .waitFor({ state: "attached" });
}

test("add garments with product identity -> browse the closet -> retire, don't delete", async ({
  page,
}) => {
  const email = `demo-${String(Date.now())}@example.com`;

  await page.goto("/auth/signup");
  await hydrated(page);
  await page.getByLabel("Name").fill("Demo Runner");
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill("a-long-enough-password");
  await page.getByRole("button", { name: "Sign up" }).click();
  await expect(page.getByText(email)).toBeVisible({ timeout: 15_000 });

  await page.getByRole("link", { name: "Closet" }).click();
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

  // Retire, don't delete: the shoes drop out of the default view but stay
  // reachable behind the retired toggle — never gone.
  await page.getByRole("link", { name: /Nike Pegasus 41/ }).click();
  await page.getByRole("button", { name: "Retire" }).click();
  await expect(page.getByRole("button", { name: "Unretire" })).toBeVisible();
  await expect(page.getByText("[RETIRED]", { exact: true })).toBeVisible();

  await page.getByRole("link", { name: "Closet" }).click();
  await expect(
    page.getByRole("link", { name: /Nike Pegasus 41/ }),
  ).toHaveCount(0);
  await page.getByRole("button", { name: "Show retired (1)" }).click();
  await expect(
    page.getByRole("link", { name: /Nike Pegasus 41/ }),
  ).toBeVisible();
});
