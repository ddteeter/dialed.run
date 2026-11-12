import { expect, test } from "../support/a11y";

import { notifications } from "../../src/db/schema-core";
import { newUlid } from "../../src/lib/ids";
import { nowSeconds } from "../../src/lib/now";
import { storageStateFor } from "../support/accounts";
import { DESK, PHONE } from "../support/bars";
import {
  fillsOf,
  hydrated,
  leavesOf,
  openBoard,
  part,
} from "../support/conformance";
import { signInAsKnownUser } from "../support/known-user";
import { withLocalDb } from "../support/local-db";
import { feedUserId, removeSeeded, seeded } from "./feed-support";

/**
 * M, redrawn to S2c — round 22's "M Mark all read in flight" — and the
 * bell round 22 put on every signed-in screen.
 *
 * Unread is a white row and a pink dot, read is the paper; Mark all read
 * breathes in place while the rows stay as they are. At desk the screen
 * is DS3's panel, not a column (R-102).
 */
test.use({ storageState: storageStateFor("feed") });

const BOARD = "Round 22 Coverage.dc.html";
const M = "M Mark all read in flight";

/**
Visible words, upper-cased as the harness compares them.
*/
function upper(leaves: readonly { text: string }[]): string[] {
  return leaves.map((leaf) => leaf.text.toUpperCase());
}

/**
 * The board's three rows for the feed account: two unread, then one read,
 * newest first. Their ids go on `rows`, to be taken out with it.
 */
async function seedBoardRows(
  rows: ReturnType<typeof seeded>,
): Promise<readonly { body: string; read: boolean; createdAt: number }[]> {
  const userId = await feedUserId();
  const now = nowSeconds();
  const drafts = [
    { body: "Your run import didn't work.", read: false, createdAt: now },
    {
      body: "New run on Strava — log your kit?",
      read: false,
      createdAt: now - 60,
    },
    { body: "Your run import didn't work.", read: true, createdAt: now - 120 },
  ];
  await withLocalDb(async ({ core }) => {
    for (const draft of drafts) {
      const id = newUlid();
      rows.notifications.push(id);
      await core.insert(notifications).values({
        id,
        userId,
        kind: "import_failed",
        subjectId: newUlid(),
        ...draft,
      });
    }
  });
  return drafts;
}

test("M in flight: white-and-dot rows, and Mark all read breathing in place", async ({
  page,
  baseURL,
}) => {
  if (baseURL === undefined) throw new Error("no baseURL");

  await openBoard(page, BOARD, baseURL);
  const drawnDots = await fillsOf(
    page,
    `${part(M, "notification-row")}[data-state="unread"]`,
  );
  const drawnLeaves = await leavesOf(page, part(M, "mark-all"));
  const drawn = {
    rowFills: await fillsOf(page, part(M, "notification-list")),
    dotFill: drawnDots[0],
    marking: upper(drawnLeaves),
  };
  expect(drawn.rowFills, "the board has no M rows").not.toHaveLength(0);

  const rows = seeded();
  const drafts = await seedBoardRows(rows);

  try {
    await page.setViewportSize(PHONE);
    await page.goto("/notifications");
    await hydrated(page);

    // **Unread on white, read on the paper** — the wash is gone.
    const fills = await fillsOf(page, '[data-part="notification-list"]');
    expect(fills.slice(0, drawn.rowFills.length)).toEqual(drawn.rowFills);
    const dots = await fillsOf(
      page,
      '[data-part="notification-row"][data-state="unread"]',
    );
    expect(dots[0]).toBe(drawn.dotFill);

    // **In flight, the label breathes in place** and nothing else moves.
    const held = Promise.withResolvers<undefined>();
    await page.route("**/_serverFn/**", async (route) => {
      await held.promise;
      await route.continue();
    });
    await page.getByRole("button", { name: "Mark all read" }).click();
    const markAll = '[data-part="mark-all"][data-state="pending"]';
    await page.locator(markAll).waitFor();
    expect(upper(await leavesOf(page, markAll))).toEqual(drawn.marking);
    const inFlight = await fillsOf(page, '[data-part="notification-list"]');
    expect(inFlight.slice(0, drawn.rowFills.length)).toEqual(drawn.rowFills);
    // Let the call land, and wait for what it does (#566). Taking the
    // route away releases a held call, so it used to land on its own
    // while the spec went on: the list re-read itself in a race with the
    // teardown below, and when the rows were deleted first the test ended
    // on the empty screen instead of three read rows.
    held.resolve(undefined);
    await expect(page.locator('[data-part="mark-all"]')).toHaveCount(0);
    await expect(
      page.locator('[data-part="notification-row"][data-state="read"]'),
    ).toHaveCount(drafts.length);
    await page.unrouteAll({ behavior: "ignoreErrors" });

    // **At desk it is the panel** (DS3, R-102): 390 wide, not the column.
    await page.setViewportSize(DESK);
    const panel = page
      .getByRole("heading", { name: "Notifications" })
      .locator("xpath=ancestor::div[contains(@class, 'max-w-panel')]");
    const box = await panel.boundingBox();
    expect(box?.width).toBeLessThanOrEqual(390);
  } finally {
    await removeSeeded(rows);
  }
});

// The test above ends with every row read. This one ends before Mark all
// read is pressed, so what a screen reader is given for an unread row and
// for the button is checked in (#582).
test("M at rest: two unread rows, one read, and Mark all read", async ({
  page,
}) => {
  const rows = seeded();
  await seedBoardRows(rows);
  try {
    await page.setViewportSize(PHONE);
    await page.goto("/notifications");
    await hydrated(page);

    await expect(
      page.locator('[data-part="notification-row"][data-state="unread"]'),
    ).toHaveCount(2);
    await expect(
      page.getByRole("button", { name: "Mark all read" }),
    ).toBeVisible();
  } finally {
    await removeSeeded(rows);
  }
});

test("the bell is on the feed's own screens (R-102)", async ({ page }) => {
  await page.setViewportSize(PHONE);
  for (const path of ["/feed", "/feed/me", "/feed/search"]) {
    await page.goto(path);
    await hydrated(page);
    await expect(
      page
        .getByRole("link", { name: /^Notifications/u })
        .filter({ visible: true }),
    ).toHaveCount(1);
  }
});

/**
 * S2b, the empty list. No other spec ends on it, so the a11y fixture
 * never read it: it carried a `p-as-heading` finding that showed only
 * when M's teardown beat M's own reload (#566). A runner of its own,
 * because the feed's runner has rows whenever another spec has left one.
 */
test.describe("with nothing to show", () => {
  test.use({ storageState: { cookies: [], origins: [] } });

  test("S2b: an empty list says Quiet, as a heading", async ({ page }) => {
    await signInAsKnownUser(page, "e2e-quiet-bell", "quiet_bell");
    await page.setViewportSize(PHONE);
    await page.goto("/notifications");
    await hydrated(page);
    await expect(
      page.getByRole("heading", { level: 2, name: "Quiet" }),
    ).toBeVisible();
    await expect(page.locator('[data-part="mark-all"]')).toHaveCount(0);
  });
});
