/**
 * Covers: `/open-source` (round 29 #9; plan C9; D-137) — reached from the
 * signed-out footer, the thank-you, the type group first, a licence's text
 * opened once, Show all, the search and its empty line, and the
 * third-party notices. One journey, one video.
 */
import { expect, hydrated, scene, test } from "../support/demo";

test("the open-source page: groups by licence, search, and the notices", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1040, height: 760 });
  await page.goto("/auth/login");
  await hydrated(page);

  await scene(page, "The signed-out footer · Open source, after Copyright");
  await page
    .locator("[data-part='legal-footer']")
    .getByRole("link", { name: "Open source" })
    .click();
  await expect(page).toHaveURL(/\/open-source$/u);
  await hydrated(page);
  await expect(
    page.getByRole("heading", { level: 1, name: "Built with thanks" }),
  ).toBeVisible();
  await expect(page.getByText(/Here are all \d+ pieces/u)).toBeVisible();

  await scene(page, "The type comes first, then the licences, largest first");
  const sections = page.locator("main section h2");
  await expect(sections.first()).toHaveText("SIL Open Font License 1.1");
  await expect(sections.nth(1)).toHaveText("MIT");
  await expect(page.getByText("IBM Plex Mono")).toBeVisible();

  await scene(page, "Each licence's text is printed once, when asked for");
  const mit = page.locator("section", {
    has: page.getByRole("heading", { level: 2, name: "MIT" }),
  });
  await mit.getByText("Read the MIT licence").click();
  await expect(mit.locator("pre").first()).toContainText(
    "Permission is hereby granted",
  );

  await scene(page, "Three rows, then Show all");
  await expect(mit.getByRole("listitem")).toHaveCount(3);
  await mit.getByRole("button", { name: /^Show all \d+$/u }).click();
  await expect(mit.getByRole("button", { name: /^Show all/u })).toHaveCount(0);
  expect(await mit.getByRole("listitem").count()).toBeGreaterThan(3);

  await scene(page, "Search filters every group by package name");
  const search = page.getByRole("searchbox", { name: "Find a package" });
  await search.fill("zod");
  await expect(mit.getByText("zod", { exact: true })).toBeVisible();
  await expect(
    page.getByRole("heading", { level: 2, name: "SIL Open Font License 1.1" }),
  ).toHaveCount(0);

  await scene(page, "Nothing matches · it says so");
  await search.fill("xyz");
  await expect(
    page.getByText("Nothing we ship is called “xyz”."),
  ).toBeVisible();
  await search.fill("");

  await scene(page, "The third-party notices close the page");
  const notices = page.getByRole("heading", {
    level: 2,
    name: "Third-party notices",
  });
  await notices.scrollIntoViewIfNeeded();
  await expect(notices).toBeVisible();
  await expect(
    page.getByRole("heading", { level: 3, name: "Weather data" }),
  ).toBeVisible();
});
