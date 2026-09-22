import { expect, test } from "@playwright/test";

/** Not part of the auth journey, so it lives outside the demo: keeping it
 *  here would put a second, unrelated video beside the one a reviewer is
 *  meant to watch. */
test("home renders the brand hero", async ({ page }) => {
  await page.goto("/");
  await expect(
    page.getByRole("heading", { name: /every run has an outfit/i }),
  ).toBeVisible();
});

/**
 * The fonts are discoverable in the initial HTML.
 *
 * They were an `@import` at the top of `src/styles.css`, where the
 * browser's preload scanner cannot see them: the request could not start
 * until that file had been fetched and parsed, so the font CSS, the font
 * files and the app CSS went out strictly in series — and the two
 * preconnects in `__root.tsx` warmed a connection nothing was using yet.
 * The visible cost was a reflow a second into every cold load, which is
 * what a reviewer saw jump through the opening of the feed demo.
 *
 * Asserted against the served markup rather than the live DOM, because
 * what matters is that it is *in the HTML* before any script runs. A
 * `page.locator` would pass just as happily against a link React added
 * afterwards, which is the thing being ruled out.
 */
test("serves the font stylesheet in the head, ahead of the app's", async ({
  page,
}) => {
  const response = await page.goto("/");
  const html = (await response?.text()) ?? "";

  const fontCss = html.indexOf("fonts.googleapis.com/css2");
  const appCss = html.indexOf("/styles.css");
  expect(fontCss, "font stylesheet missing from the served HTML").toBeGreaterThan(-1);
  expect(appCss, "app stylesheet missing from the served HTML").toBeGreaterThan(-1);
  // First, so the `@font-face` rules are known as early as possible.
  expect(fontCss).toBeLessThan(appCss);
  // And not back in the stylesheet, which is where it started.
  expect(html).not.toContain('@import url("https://fonts');
});
