import { eq } from "drizzle-orm";
import { expect, test } from "@playwright/test";
import type { Page } from "@playwright/test";

import { wardrobeItems } from "../../src/db/schema-core";
import { newUlid } from "../../src/lib/ids";
import { nowSeconds } from "../../src/lib/now";
import { storageStateFor } from "../support/accounts";
import { cellsOf, openBoard } from "../support/conformance";
import { withLocalDb } from "../support/local-db";
import { closetUserId } from "./closet-seed";

/**
 * The closet at desk with no rail, against round 22's ruling 16.
 *
 * **Ruled, not drawn** — round 22 answered it in words ("drawings due
 * round 23"), so the words are what the board gives to compare against.
 * They are read out of the ruling's own paragraph on the board rather than
 * typed here: the quoted strings in it are the copy, and a redraw that
 * changes them changes this test's expectation with it.
 *
 * The closet account belongs to the closet demo as well, which fills it.
 * So its garments are parked on a throwaway owner for the length of this
 * spec and handed back after, whichever order the two run in.
 */
test.use({ storageState: storageStateFor("closet") });

const RULING = "16 · CLOSET AT DESK, NO RAIL";

/**
The ruling's quoted strings: "47 pieces", "Show retired", the empty copy.
*/
async function rulingQuotes(page: Page): Promise<string[]> {
  const paragraph = await page
    .locator("span", { hasText: RULING })
    .locator("xpath=following-sibling::p[1]")
    .textContent();
  return Array.from(
    (paragraph ?? "").matchAll(/"(?<quote>[^"]+)"/gu),
    (match) => match.groups?.quote ?? "",
  );
}

/**
`[ NOTHING IN HERE YET ]` and `[NOTHING IN HERE YET]` are one statement.
*/
function tight(text: string): string {
  return text.replaceAll("[ ", "[").replaceAll(" ]", "]").toUpperCase();
}

/**
The closet account's id, held on an object: written in `beforeAll`.
*/
const account: { id?: string } = {};
const parkedOwner = newUlid();

function closetOwner(): string {
  if (account.id === undefined) throw new Error("no closet account");
  return account.id;
}

test.beforeAll(async () => {
  account.id = await closetUserId();
  const userId = closetOwner();
  await withLocalDb(async ({ core }) => {
    await core
      .update(wardrobeItems)
      .set({ userId: parkedOwner })
      .where(eq(wardrobeItems.userId, userId));
  });
});

test.afterAll(async () => {
  const userId = closetOwner();
  await withLocalDb(async ({ core }) => {
    await core
      .delete(wardrobeItems)
      .where(eq(wardrobeItems.userId, userId));
    await core
      .update(wardrobeItems)
      .set({ userId })
      .where(eq(wardrobeItems.userId, parkedOwner));
  });
});

test("the empty closet says what ruling 16 says, and offers the dashed tile", async ({
  page,
  baseURL,
}) => {
  if (baseURL === undefined) throw new Error("no baseURL");

  await openBoard(page, "Round 22 Coverage.dc.html", baseURL);
  const quotes = await rulingQuotes(page);
  // Guard the guard: a ruling reworded out of quotes would compare nothing.
  expect(quotes, "ruling 16 has no quoted copy").toHaveLength(4);
  const statement = quotes.at(2);
  const invitation = quotes.at(3);

  await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto("/closet");
  await page.locator('html[data-hydrated="true"]').waitFor({ state: "attached" });

  expect(tight(await page.getByRole("heading", { level: 1 }).innerText())).toBe(
    tight(statement ?? ""),
  );
  await expect(page.getByText(invitation ?? "", { exact: true })).toBeVisible();

  // "+ the dashed Add tile" — the grid's only cell, and dashed.
  expect(await cellsOf(page, '[data-part="grid"]')).toStrictEqual([
    "ADD GARMENT",
  ]);
  const tile = page.getByRole("link", { name: "Add garment" });
  expect(
    await tile.evaluate((element) => getComputedStyle(element).borderStyle),
  ).toBe("dashed");
  // And nothing about pieces there are none of.
  await expect(page.getByRole("switch")).toHaveCount(0);
});

test("the heading row counts the pieces on the left, the switch on the right", async ({
  page,
  baseURL,
}) => {
  if (baseURL === undefined) throw new Error("no baseURL");

  await openBoard(page, "Round 22 Coverage.dc.html", baseURL);
  const [count, switchLabel] = await rulingQuotes(page);

  const createdAt = nowSeconds();
  const userId = closetOwner();
  await withLocalDb(async ({ core }) => {
    await core.insert(wardrobeItems).values([
      { id: newUlid(), userId, category: "top", name: "Harrier", createdAt },
      {
        id: newUlid(),
        userId,
        category: "top",
        name: "Old singlet",
        retired: true,
        createdAt,
      },
    ]);
  });

  await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto("/closet");
  await page.locator('html[data-hydrated="true"]').waitFor({ state: "attached" });

  // "47 pieces" is a shape: a number and the word. One active piece shows.
  const heading = page.getByRole("heading", { level: 1 });
  expect(count).toMatch(/^\d+ pieces$/u);
  await expect(heading).toHaveText("1 piece");
  const toggle = page.getByRole("switch", { name: switchLabel ?? "" });
  await expect(toggle).toBeVisible();

  // Left and right, on one row.
  const headingBox = await heading.boundingBox();
  const switchBox = await toggle.boundingBox();
  if (headingBox === null || switchBox === null) throw new Error("not drawn");
  expect(switchBox.x).toBeGreaterThan(headingBox.x + headingBox.width);
  expect(switchBox.y).toBeLessThan(headingBox.y + headingBox.height);

  // Retired: the same tile, sorted last, [RETIRED] in the kicker.
  await toggle.check();
  const cells = await cellsOf(page, '[data-part="grid"]');
  expect(cells.at(-2)).toMatch(/^OLD SINGLET .*\[ RETIRED \]/u);
  expect(cells.at(-1)).toBe("ADD GARMENT");
});
