import { expect, test } from "@playwright/test";

import { nowSeconds } from "../../src/lib/now";
import { storageStateFor } from "../support/accounts";
import { PHONE } from "../support/bars";
import { cellsOf, leavesOf, openBoard, part } from "../support/conformance";
import {
  feedUserId,
  fillOf,
  folded,
  hydrated,
  partsIn,
  removeSeeded,
  seedEntry,
  seeded,
  seedFollow,
  seedPhoto,
  seedRunner,
  unfollowEveryone,
} from "./feed-support";

/**
 * E1, Following — round 22's "E1v1 Following" and "E1v1 Following empty".
 *
 * **A post's words are data, so the card is compared by composition**:
 * which parts, in what order, wearing which fill. The board's `dana_k`
 * and `8.1 MI` never enter the diff; its order and its teal do. The empty
 * state is copy and nothing else, so it is compared word for word.
 */
test.use({ storageState: storageStateFor("feed") });

const BOARD = "Round 22 Coverage.dc.html";
const CARD = "E1v1 Following";
const EMPTY = "E1v1 Following empty";

function drawnPost(state: string): string {
  return `${part(CARD, "post")}[data-state="${state}"]`;
}

function builtPost(entryId: string): string {
  return `[data-part="post"]:has(a[href="/feed/entry/${entryId}"])`;
}

/**
The visible words of a region's leaves, as one line.
*/
async function spoken(
  page: import("@playwright/test").Page,
  selector: string,
): Promise<string> {
  const leaves = await leavesOf(page, selector);
  return folded(leaves.map((leaf) => leaf.text.toUpperCase())).join(" ");
}

test("E1's v1 card is composed as the board draws it, with a photo, without, and indoors", async ({
  page,
  baseURL,
}) => {
  if (baseURL === undefined) throw new Error("no baseURL");

  // ---- What the board draws ------------------------------------------
  await openBoard(page, BOARD, baseURL);
  const drawn = {
    withPhoto: await partsIn(page, drawnPost("with-photo")),
    noPhoto: await partsIn(page, drawnPost("no-photo")),
    indoor: await partsIn(page, drawnPost("no-conditions")),
    dialedFill: await fillOf(
      page,
      `${drawnPost("with-photo")} [data-part="verdict-badge"]`,
    ),
    offFill: await fillOf(
      page,
      `${drawnPost("no-photo")} [data-part="verdict-badge"]`,
    ),
    indoorStrip: await cellsOf(
      page,
      `${drawnPost("no-conditions")} [data-part="run-strip"]`,
    ),
    zeroUseful: await spoken(
      page,
      `${drawnPost("no-conditions")} [data-part="reactions"]`,
    ),
  };
  // Guard the guard: an empty list compares equal to another empty one.
  expect(drawn.withPhoto, "the board has no E1 post regions").not.toHaveLength(
    0,
  );

  // ---- What we built --------------------------------------------------
  const rows = seeded();
  const runner = await seedRunner(rows, `E1 runner ${String(Date.now())}`);
  const startedAt = nowSeconds() - 2 * 3600;
  const withPhoto = await seedEntry(rows, {
    userId: runner,
    place: { lat: 61.37, lng: 12.41 },
    startedAt,
    feelsLikeC: 5,
    verdict: 0,
    caption: "Half-zip was right.",
  });
  const noPhoto = await seedEntry(rows, {
    userId: runner,
    place: { lat: 61.38, lng: 12.41 },
    startedAt: startedAt - 60,
    feelsLikeC: 8,
    verdict: 1,
    caption: "Wore the shell for a forecast that never showed up.",
  });
  const indoor = await seedEntry(rows, {
    userId: runner,
    place: { lat: 61.39, lng: 12.41 },
    startedAt: startedAt - 120,
    verdict: 0,
    isIndoor: true,
  });
  await seedPhoto(rows, withPhoto.entryId);
  await seedFollow(await feedUserId(), runner);

  try {
    await page.setViewportSize(PHONE);
    await page.goto("/feed");
    await hydrated(page);
    // Following anyone opens on Following (round 22).
    await expect(
      page.getByRole("button", { name: "Following" }),
    ).toHaveAttribute("aria-current", "page");

    // **The same parts, in the same fixed order**: author and badge,
    // photo, caption, strip, Useful — and a missing one absent.
    expect(await partsIn(page, builtPost(withPhoto.entryId))).toEqual(
      drawn.withPhoto,
    );
    expect(await partsIn(page, builtPost(noPhoto.entryId))).toEqual(
      drawn.noPhoto,
    );
    expect(await partsIn(page, builtPost(indoor.entryId))).toEqual(
      drawn.indoor,
    );

    // **The badge fill follows A3**: dialed teal, off verdicts unfilled.
    expect(
      await fillOf(
        page,
        `${builtPost(withPhoto.entryId)} [data-part="verdict-badge"]`,
      ),
    ).toBe(drawn.dialedFill);
    expect(
      await fillOf(
        page,
        `${builtPost(noPhoto.entryId)} [data-part="verdict-badge"]`,
      ),
    ).toBe(drawn.offFill);

    // **No conditions reads INDOOR**, behind the same divider — never a
    // dash. The distance is data; the divider and the word are not.
    const strip = await cellsOf(
      page,
      `${builtPost(indoor.entryId)} [data-part="run-strip"]`,
    );
    expect(strip).toHaveLength(drawn.indoorStrip.length);
    expect(strip.slice(1)).toEqual(drawn.indoorStrip.slice(1));

    // **Zero Useful reads "♡ USEFUL"**, with no zero.
    expect(
      await spoken(
        page,
        `${builtPost(indoor.entryId)} [data-part="reactions"]`,
      ),
    ).toBe(drawn.zeroUseful);
  } finally {
    await removeSeeded(rows);
  }
});

test("E1's empty Following says what the board says, word for word", async ({
  page,
  baseURL,
}) => {
  if (baseURL === undefined) throw new Error("no baseURL");

  await openBoard(page, BOARD, baseURL);
  const drawnCells = await cellsOf(
    page,
    `${part(EMPTY, "feed")}[data-state="empty"]`,
  );
  const drawnPrimary = await fillOf(page, part(EMPTY, "primary-action"));
  expect(drawnCells, "the board has no E1 empty region").not.toHaveLength(0);

  await unfollowEveryone(await feedUserId());
  await page.setViewportSize(PHONE);
  await page.goto("/feed");
  await hydrated(page);

  // **Zero follows lands on Your conditions** (round 22); Following is a
  // tab away, and the board's empty state is what is there.
  await expect(
    page.getByRole("button", { name: "Your conditions" }),
  ).toHaveAttribute("aria-current", "page");
  await page.getByRole("button", { name: "Following" }).click();

  const built = '[data-part="feed"][data-state="empty"]';
  await page.locator(built).waitFor();
  expect(folded(await cellsOf(page, built))).toEqual(folded(drawnCells));
  expect(await fillOf(page, `${built} [data-part="primary-action"]`)).toBe(
    drawnPrimary,
  );
});
