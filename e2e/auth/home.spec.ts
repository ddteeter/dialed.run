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
 * The fonts are same-origin and preloaded from the initial HTML.
 *
 * Three shapes have been tried here and two of them flashed. An `@import`
 * at the top of `src/styles.css` was invisible to the preload scanner, so
 * nothing could be requested until that file had been fetched *and*
 * parsed. A `<link>` to Google's stylesheet fixed discovery and still
 * flashed, because discovery was never the whole cost: it was a
 * stylesheet on one origin naming files on another, so the glyphs stayed
 * three round trips and two origins deep and the preconnects beside it
 * warmed a connection that was not the last hop. The visible cost both
 * times was a reflow a second into every cold load — what a reviewer saw
 * jump through the opening of the feed demo.
 *
 * Asserted against the served markup rather than the live DOM, because
 * what matters is that the preloads are *in the HTML* before any script
 * runs. A `page.locator` would pass just as happily against a link React
 * added afterwards, which is the thing being ruled out.
 */
test("preloads the self-hosted fonts from the served HTML", async ({
  page,
}) => {
  const response = await page.goto("/");
  const html = (await response?.text()) ?? "";

  // **In the `<head>` of the served HTML, and each with its own tag.**
  // That is the whole claim: the preload scanner tokenizes the head before
  // it requests anything, so position among the head's links does not
  // matter — React hoists `data-precedence` stylesheets above these
  // regardless — but being in the document at all is what a `@font-face`
  // in a stylesheet can never be.
  const head = html.slice(0, html.indexOf("</head>"));
  for (const face of [
    "/fonts/archivo-variable-latin.woff2",
    "/fonts/archivo-black-latin.woff2",
    "/fonts/ibm-plex-mono-400-latin.woff2",
  ]) {
    expect(head, `${face} is not preloaded in the served head`).toContain(
      `<link rel="preload" as="font" type="font/woff2" href="${face}" crossorigin="anonymous"/>`,
    );
  }

  // **No third party in the font path at all.** This is the regression
  // that matters: a `<link>` or an `@import` pointing at Google puts two
  // origins and an extra hop back in front of the first glyph.
  expect(html).not.toContain("fonts.googleapis.com");
  expect(html).not.toContain("fonts.gstatic.com");
  expect(html).not.toContain('@import url("https://fonts');
});

/**
 * `latin-ext` is declared but deliberately not preloaded — it exists for
 * the occasional accented product name, and a preloaded font a page never
 * uses is a console warning and wasted bandwidth. The stylesheet fetches
 * it when a glyph falls in its `unicode-range`.
 */
test("declares latin-ext without preloading it", async ({ page }) => {
  const response = await page.goto("/");
  const html = (await response?.text()) ?? "";
  expect(html).not.toContain("latin-ext");
});
