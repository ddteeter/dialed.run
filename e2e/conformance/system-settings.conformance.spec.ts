import { expect, test } from "@playwright/test";

import { storageStateFor } from "../support/accounts";
import { openBoard, screen } from "../support/conformance";
import { hydrated, partsIn, wordsOf } from "./auth-parts";

/**
 * The settings index against U1 (`design/Remaining Screens.dc.html`), as
 * round 22's item 20 rules it: U1's tap-through index wins.
 *
 * U1 draws ten rows, and the build has five: **a row with nowhere to go is
 * absent** (account, notifications, export, delete have no page yet), so
 * this asserts the build's rows are U1's rows *in U1's order*, and its
 * group headings are U1's headings in U1's order — never that every drawn
 * row exists. The calibration row's name is the ruling's ("How you run"),
 * which U1's longer "How you run warm or cold" begins with.
 */
test.use({ storageState: storageStateFor("closet") });

/**
 * Whether `wanted` appears in `words` in order, each matched by prefix.
 */
function inOrder(
  words: readonly string[],
  wanted: readonly string[],
): { found: string[]; missing: string | undefined } {
  const found: string[] = [];
  let from = 0;
  for (const word of wanted) {
    const at = words.findIndex(
      (candidate, index) => index >= from && candidate.startsWith(word),
    );
    if (at === -1) return { found, missing: word };
    found.push(word);
    from = at + 1;
  }
  return { found, missing: undefined };
}

test("the index: U1's groups and rows, in U1's order, keeping the tab bar", async ({
  page,
  baseURL,
}) => {
  if (baseURL === undefined) throw new Error("no baseURL");
  const label = "U1 Settings index";
  await openBoard(page, "Remaining Screens.dc.html", baseURL);
  const drawn = await wordsOf(page, screen(label));
  const drawnParts = await partsIn(page, screen(label));
  expect(drawn, "the board has no U1 frame").not.toHaveLength(0);

  await page.setViewportSize({ width: 390, height: 900 });
  await page.goto("/onboarding/settings");
  await hydrated(page);

  const headings = await page
    .getByRole("heading", { level: 2 })
    .allTextContents();
  const headingsInBoard = inOrder(
    drawn,
    headings.map((heading) => heading.toUpperCase()),
  );
  expect(headingsInBoard.missing).toBeUndefined();

  const rows = await page
    .locator("[data-part='settings-row'] .font-semibold")
    .allTextContents();
  expect(rows.length).toBeGreaterThan(0);
  const rowsInBoard = inOrder(
    drawn,
    rows.map((row) => row.toUpperCase()),
  );
  expect(rowsInBoard.missing).toBeUndefined();

  // "Index keeps the tab bar (it's under You)", with You lit.
  expect(drawnParts).toContain("tab-bar");
  await expect(page.locator("[data-part='tab-bar']")).toBeVisible();
  await expect(
    page.locator("[data-slot='tab-bar']").getByRole("link", { name: "You" }),
  ).toHaveClass(/text-ink/u);
});
