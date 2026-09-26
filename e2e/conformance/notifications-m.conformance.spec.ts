import { expect, test } from "@playwright/test";

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
import { withLocalDb } from "../support/local-db";
import { feedUserId, holdForever, removeSeeded, seeded } from "./feed-support";

/**
 * M, redrawn to S2c — round 22's "M Mark all read in flight" — and the
 * bell round 22 put on every signed-in screen.
 *
 * Unread is a white row and a pink dot, read is the paper; Mark all read
 * breathes in place while the rows stay as they are. At desk the screen
 * is DS3's panel, not a column (D-102).
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

  const userId = await feedUserId();
  const rows = seeded();
  const now = nowSeconds();
  // The board's three: two unread, then one read — newest first.
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
    await page.route("**/_serverFn/**", holdForever);
    await page.getByRole("button", { name: "Mark all read" }).click();
    const markAll = '[data-part="mark-all"][data-state="pending"]';
    await page.locator(markAll).waitFor();
    expect(upper(await leavesOf(page, markAll))).toEqual(drawn.marking);
    const inFlight = await fillsOf(page, '[data-part="notification-list"]');
    expect(inFlight.slice(0, drawn.rowFills.length)).toEqual(drawn.rowFills);
    await page.unrouteAll({ behavior: "ignoreErrors" });

    // **At desk it is the panel** (DS3, D-102): 390 wide, not the column.
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

test("the bell is on the feed's own screens (D-102)", async ({ page }) => {
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
