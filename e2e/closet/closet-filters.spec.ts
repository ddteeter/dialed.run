import { inArray } from "drizzle-orm";

import { wardrobeItems } from "../../src/db/schema-core";
import { unitToC } from "../../src/lib/contracts/temperature";
import { newUlid } from "../../src/lib/ids";
import { nowSeconds } from "../../src/lib/now";
import { closetUserId } from "../conformance/closet-seed";
import { expect, test } from "../support/a11y";
import { storageStateFor } from "../support/accounts";
import { withLocalDb } from "../support/local-db";

/**
 * Closet C's rail before hydration (R-94, design 174; round 46 #109h):
 * with no script at all, GROUP and COVERAGE are links and WORKS AT is a
 * plain GET form — "Lowest" to "Highest", Apply — that names the unit it
 * was typed in. The demo drives the hydrated rail; this
 * is the page a runner gets while the bundle is still on its way.
 *
 * Two pieces seeded on the closet account, and only those two asserted
 * on and removed: the account is the demo's too, and holds whatever the
 * demo left.
 */
test.use({
  storageState: storageStateFor("closet"),
  javaScriptEnabled: false,
});

const shell = { id: newUlid(), name: `Cold shell ${newUlid()}` };
const singlet = { id: newUlid(), name: `Race singlet ${newUlid()}` };

test.beforeAll(async () => {
  const userId = await closetUserId();
  const createdAt = nowSeconds();
  await withLocalDb(async ({ core }) => {
    await core.insert(wardrobeItems).values([
      {
        ...shell,
        userId,
        category: "top",
        layer: "outer",
        estTempLowC: unitToC(20, "f"),
        estTempHighC: unitToC(40, "f"),
        createdAt,
      },
      {
        ...singlet,
        userId,
        category: "top",
        estTempLowC: unitToC(62, "f"),
        estTempHighC: unitToC(78, "f"),
        createdAt,
      },
    ]);
  });
});

test.afterAll(async () => {
  await withLocalDb(async ({ core }) => {
    await core
      .delete(wardrobeItems)
      .where(inArray(wardrobeItems.id, [shell.id, singlet.id]));
  });
});

test("WORKS AT filters the closet with no script, in the runner's unit", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto("/closet");
  const rail = page.locator("nav[data-part='rail']");
  await expect(rail.getByLabel("Lowest")).toBeVisible();

  await rail.getByLabel("Lowest").fill("60");
  await rail.getByLabel("Highest").fill("80");
  await rail.getByRole("button", { name: "Apply" }).click();

  // The form said what it typed in; the server read it as Fahrenheit.
  await expect(page).toHaveURL(/[?&]unit=f(&|$)/u);
  await expect(page.locator("[data-part='filtered']")).toHaveText(
    /^Filtered:\s*\[\s*60–80°\s*\]$/u,
  );
  await expect(
    page.getByRole("link", { name: new RegExp(singlet.name, "u") }),
  ).toBeVisible();
  await expect(
    page.getByRole("link", { name: new RegExp(shell.name, "u") }),
  ).toHaveCount(0);
  await expect(rail.getByLabel("Lowest")).toHaveValue("60");

  // A group link from here keeps the span, in Celsius now, and the shell
  // (20–40°F) still does not overlap it.
  await rail.getByRole("link", { name: /^Outer/ }).click();
  await expect(page).toHaveURL(/[?&]group=outer/u);
  await expect(page).toHaveURL(/[?&]from=15\.6&to=26\.7/u);
  await expect(
    page.getByRole("link", { name: new RegExp(shell.name, "u") }),
  ).toHaveCount(0);

  await rail.getByRole("link", { name: "Any" }).click();
  await expect(
    page.getByRole("link", { name: new RegExp(shell.name, "u") }),
  ).toBeVisible();
});
