/**
 * Covers: D2 (Desk · Duplicates, task 110): the rail opens it, and each
 * probable product reads as its brand, the most-used spelling in bold,
 * and the pieces filed under every spelling, sorted by pieces affected.
 * Read-only (D-30): nothing on the page acts.
 *
 * Needs `ADMIN_USER_IDS=e2e-desk-operator` in the dev server's
 * `.dev.vars`, as `operator.demo.spec.ts` does.
 *
 * Exactly one test() per demo spec.
 */
import { inArray } from "drizzle-orm";

import { brands, products, wardrobeItems } from "../../src/db/schema-core";
import { newUlid } from "../../src/lib/ids";
import { nowSeconds } from "../../src/lib/now";
import { expect, scene, test } from "../support/demo";
import { withLocalDb } from "../support/local-db";
import { signInAsOperator } from "./operator";

/**
Two near-miss spellings under one brand, and the pieces under each.
*/
const SEED = [
  {
    brand: "Tracksmith",
    variants: [
      ["Harrier Long Sleeve", 5],
      ["Harrier Long Sleeves", 2],
    ],
  },
  {
    brand: "Janji",
    variants: [
      ["Rapid Short", 3],
      ["Rapid Shorts", 1],
    ],
  },
] as const;

test("an operator reads the Desk's duplicates report", async ({ page }) => {
  const brandIds: string[] = [];
  const productIds: string[] = [];
  const pieceIds: string[] = [];
  await withLocalDb(async ({ core }) => {
    const now = nowSeconds();
    for (const { brand, variants } of SEED) {
      const brandId = newUlid();
      brandIds.push(brandId);
      // Suffixed so a brand the local database already holds cannot
      // collide with UNIQUE(normalized).
      await core.insert(brands).values({
        id: brandId,
        name: brand,
        normalized: `${brand.toLowerCase()} ${brandId}`,
      });
      for (const [name, pieces] of variants) {
        const productId = newUlid();
        productIds.push(productId);
        await core.insert(products).values({
          id: productId,
          brandId,
          name,
          normalizedName: name.toLowerCase(),
          createdBy: newUlid(),
          createdAt: now,
        });
        const ids = Array.from({ length: pieces }, () => newUlid());
        pieceIds.push(...ids);
        await core.insert(wardrobeItems).values(
          ids.map((id) => ({
            id,
            userId: newUlid(),
            category: "top" as const,
            name,
            productId,
            createdAt: now,
          })),
        );
      }
    }
  });

  await signInAsOperator(page);
  await page.goto("/desk");
  await page
    .locator('html[data-hydrated="true"]')
    .waitFor({ state: "attached" });

  await scene(page, "Duplicates is a Desk destination now, in D-87's order");
  const rail = page.getByRole("navigation", { name: "Desk" });
  await rail.getByRole("link", { name: "Duplicates" }).click();
  await expect(page).toHaveURL(/\/desk\/duplicates$/u);
  await page
    .locator('html[data-hydrated="true"]')
    .waitFor({ state: "attached" });
  // One current page: Today's `/desk` is no longer lit beside it.
  await expect(
    rail.getByRole("link", { name: "Duplicates" }),
  ).toHaveAttribute("aria-current", "page");
  await expect(rail.locator("[aria-current='page']")).toHaveCount(1);

  await scene(page, "How much dirt: names, probable products, pieces");
  await expect(
    page.getByRole("heading", { name: "Duplicates", level: 1 }),
  ).toBeVisible();
  await expect(
    page.getByText(
      /^\[\d+ names? →as \d+ probable products? · \d+ pieces? affected\]$/u,
    ),
  ).toBeVisible();
  await expect(page.getByText(/^Nothing here does anything\./u)).toBeVisible();

  await scene(page, "Each group: the brand, the probable name, the rest");
  const card = (brand: string) =>
    page
      .getByRole("listitem")
      .filter({ has: page.getByRole("heading", { name: brand }) });
  const tracksmith = card("Tracksmith");
  await expect(tracksmith.getByRole("heading")).toHaveText(
    "Tracksmith[7 pieces]",
  );
  await expect(tracksmith.locator("strong")).toHaveText("Harrier Long Sleeve");
  await expect(
    tracksmith.getByRole("listitem").nth(1),
  ).toHaveText("Harrier Long Sleeves2 pieces");

  await scene(page, "Sorted by pieces affected: seven before four");
  const headings = await page
    .getByRole("heading", { level: 2 })
    .allTextContents();
  expect(headings.indexOf("Tracksmith[7 pieces]")).toBeLessThan(
    headings.indexOf("Janji[4 pieces]"),
  );

  await scene(page, "Read-only: there is nothing to press");
  await expect(page.getByRole("main").getByRole("button")).toHaveCount(0);
  await expect(page.getByRole("main").getByRole("link")).toHaveCount(0);

  await withLocalDb(async ({ core }) => {
    await core.delete(wardrobeItems).where(inArray(wardrobeItems.id, pieceIds));
    await core.delete(products).where(inArray(products.id, productIds));
    await core.delete(brands).where(inArray(brands.id, brandIds));
  });
});
