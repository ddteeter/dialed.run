import { expect, test } from "../support/a11y";

import { storageStateFor } from "../support/accounts";
import { hydrated } from "../support/conformance";
import { partsIn, wordsOf } from "./auth-parts";

/**
 * `/` in the one signed-out frame (`design/` Round 55 · 175 and 176),
 * at the phone, 720 and 1040, and signed in.
 *
 * Round 55's frames carry no regions to compare against, so the ruling's
 * composition is asserted directly: which regions the bar has, in which
 * order, and what it says, at each width. Values are the contracts'.
 */
const BAR = "[data-slot='landing-bar']";

test.describe("logged out", () => {
  for (const width of [720, 1040] as const) {
    test(`at ${String(width)}: the wordmark, Log in, and the pink Request access`, async ({
      page,
    }) => {
      await page.setViewportSize({ width, height: 800 });
      await page.goto("/");
      await hydrated(page);

      expect(await partsIn(page, BAR)).toEqual(["wordmark", "bar-actions"]);
      expect(await wordsOf(page, `${BAR} [data-part='bar-actions']`)).toEqual([
        "LOG IN",
        "REQUEST ACCESS",
      ]);
      // The hero ends on the cross-link: the bar holds the pill.
      await expect(
        page.getByRole("main").getByRole("link", { name: "Request access" }),
      ).toBeHidden();
      await expect(page.locator("[data-slot='top-bar']")).toHaveCount(0);
      await expect(page.locator("[data-slot='tab-bar']")).toHaveCount(0);
    });
  }

  test("below 720: the bar keeps Log in, and the hero carries the pill", async ({
    page,
  }) => {
    await page.setViewportSize({ width: 390, height: 800 });
    await page.goto("/");
    await hydrated(page);
    await expect(page.locator(BAR)).toBeVisible();
    expect(await wordsOf(page, `${BAR} [data-part='bar-actions']`)).toEqual([
      "LOG IN",
    ]);
    await expect(
      page.getByRole("main").getByRole("link", { name: "Request access" }),
    ).toBeVisible();
    await expect(page.locator("[data-slot='tab-bar']")).toHaveCount(0);
  });
});

test.describe("signed in", () => {
  test.use({ storageState: storageStateFor("closet") });

  test("at 1040: the product's bar, and the hero ends on Go to your feed", async ({
    page,
  }) => {
    await page.setViewportSize({ width: 1040, height: 800 });
    await page.goto("/");
    await hydrated(page);
    await expect(page.locator("[data-slot='top-bar']")).toBeVisible();
    await expect(page.locator(BAR)).toHaveCount(0);
    await expect(
      page.getByRole("main").getByRole("link", { name: "Go to your feed" }),
    ).toBeVisible();
  });
});
