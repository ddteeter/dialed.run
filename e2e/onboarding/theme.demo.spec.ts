/**
 * Covers: U1 › Display › Theme (R48·133, design 185). System follows the
 * phone, Dark pins the page at once with no Save, a reload keeps it (the
 * head script itself is `test/lib/theme.browser.test.ts`'s, since after a
 * reload the account's value lands too), the pin carries to the next screen, and
 * System goes back to following. Signing out drops the pin, since signed
 * out is always the system. One journey, one video.
 *
 * The "phone" is Playwright's emulated `prefers-color-scheme`, so a pinned
 * choice and a followed one can be told apart: the page is pinned dark on
 * a light phone, then follows a dark phone with no pin at all.
 */
import type { Page } from "@playwright/test";

import { THEME_KEY } from "../../src/lib/browser/theme";
import { storageStateFor } from "../support/accounts";
import { expect, hydrated, scene, test } from "../support/demo";

test.use({ storageState: storageStateFor("theme") });

/**
T1's two grounds, as the browser computes them.
*/
const PAPER = "rgb(244, 243, 239)";
const INK = "rgb(11, 11, 14)";

async function cached(page: Page): Promise<string | null> {
  return page.evaluate(
    (key) => globalThis.localStorage.getItem(key),
    THEME_KEY,
  );
}

test("pin the dark theme, keep it across pages, follow the phone again", async ({
  page,
}, testInfo) => {
  testInfo.setTimeout(120_000);
  await page.emulateMedia({ colorScheme: "light" });

  await page.goto("/onboarding/settings");
  await hydrated(page);
  const theme = page.getByRole("group", { name: "Theme" });
  await theme.scrollIntoViewIfNeeded();
  await scene(page, "Settings › Display › Theme follows the phone");
  await expect(theme.getByRole("radio", { name: "System" })).toBeChecked();
  await expect(page.locator("html")).not.toHaveAttribute("data-theme");
  await expect(page.locator("body")).toHaveCSS("background-color", PAPER);

  // Dark at once, with no Save.
  await theme.getByRole("radio", { name: "Dark" }).check();
  await scene(page, "Dark: the page changes on the tap and saves");
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
  await expect(page.locator("body")).toHaveCSS("background-color", INK);
  expect(await cached(page)).toBe("dark");
  await expect(page.locator("[data-part='control-failure']")).toHaveCount(0);

  // A reload keeps it, and the radio reads the account's saved value.
  await page.reload();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
  await hydrated(page);
  await expect(
    page.getByRole("group", { name: "Theme" }).getByRole("radio", {
      name: "Dark",
    }),
  ).toBeChecked();

  await page.goto("/feed");
  await hydrated(page);
  await scene(page, "Pinned, every screen is dark on a light phone");
  await expect(page.locator("body")).toHaveCSS("background-color", INK);

  // Back to System on a dark phone: dark with no pin, by the media query.
  await page.emulateMedia({ colorScheme: "dark" });
  await page.goto("/onboarding/settings");
  await hydrated(page);
  await page
    .getByRole("group", { name: "Theme" })
    .getByRole("radio", { name: "System" })
    .check();
  await scene(page, "System follows the phone, which is dark now");
  await expect(page.locator("html")).not.toHaveAttribute("data-theme");
  await expect(page.locator("body")).toHaveCSS("background-color", INK);
  expect(await cached(page)).toBeNull();

  // Signed out is always the system, whatever was pinned.
  await page.emulateMedia({ colorScheme: "light" });
  await page
    .getByRole("group", { name: "Theme" })
    .getByRole("radio", { name: "Dark" })
    .check();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
  await page.getByRole("button", { name: "Sign out", exact: true }).click();
  await expect(page).toHaveURL(/\/$/u);
  await hydrated(page);
  await scene(page, "Signed out, the page follows the phone again");
  await expect(page.locator("html")).not.toHaveAttribute("data-theme");
  expect(await cached(page)).toBeNull();
  await expect(page.locator("body")).toHaveCSS("background-color", PAPER);
});
