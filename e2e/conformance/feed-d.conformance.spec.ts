import { expect, test } from "@playwright/test";

import { nowSeconds } from "../../src/lib/now";
import { storageStateFor } from "../support/accounts";
import { PHONE } from "../support/bars";
import {
  cellsOf,
  fillOf,
  fillsOf,
  hydrated,
  openBoard,
  part,
} from "../support/conformance";
import {
  feedUserId,
  folded,
  partsIn,
  removeSeeded,
  seedEntry,
  seeded,
  seedRunner,
} from "./feed-support";

/**
 * D, post detail — round 22's "D Sparse own entry" and "D Someone else's
 * entry".
 *
 * *"The run strip is the one part every entry has. Everything else is
 * present or absent — never a placeholder."* So D is compared the way E1's
 * card is: which parts, in what order, in which fill, with the copy that
 * is copy compared word for word.
 */
test.use({ storageState: storageStateFor("feed") });

const BOARD = "Round 22 Coverage.dc.html";
const SPARSE = "D Sparse own entry";
const THEIRS = "D Someone else's entry";

/**
The parts that are the entry itself — not the phone's bars or header.
*/
const ENTRY_PARTS = new Set([
  "photo",
  "run-strip",
  "verdict-badge",
  "verdict-prompt",
  "note",
  "kit",
  "item-flag",
  "tags",
  "reactions",
  "report",
]);

async function entryParts(
  page: import("@playwright/test").Page,
  selector: string,
): Promise<string[]> {
  const parts = await partsIn(page, selector);
  return parts.filter((name) => ENTRY_PARTS.has(name));
}

test("D's sparse own entry is the strip, the prompt in the badge's place, and the kit", async ({
  page,
  baseURL,
}) => {
  if (baseURL === undefined) throw new Error("no baseURL");

  await openBoard(page, BOARD, baseURL);
  const drawn = {
    parts: await entryParts(page, `[data-screen-label="${SPARSE}"]`),
    prompt: folded(await cellsOf(page, part(SPARSE, "verdict-prompt"))),
    promptFill: await fillOf(page, part(SPARSE, "verdict-prompt")),
    strip: await cellsOf(page, part(SPARSE, "run-strip")),
  };
  expect(drawn.parts, "the board has no sparse D").not.toHaveLength(0);

  const rows = seeded();
  // No photo, no caption, no conditions, no verdict: nothing but the run.
  const { entryId } = await seedEntry(rows, {
    userId: await feedUserId(),
    place: { lat: 62.11, lng: 13.21 },
    startedAt: nowSeconds() - 3 * 3600,
    isPublic: false,
  });

  try {
    await page.setViewportSize(PHONE);
    await page.goto(`/feed/entry/${entryId}`);
    await hydrated(page);
    await expect(page.getByRole("heading", { name: "Your run" })).toBeVisible();

    // **The same parts in the same order** — and the prompt where the
    // badge would be read, not a banner above the page.
    expect(await entryParts(page, "body")).toEqual(drawn.parts);
    expect(folded(await cellsOf(page, '[data-part="verdict-prompt"]'))).toEqual(
      drawn.prompt,
    );
    expect(await fillOf(page, '[data-part="verdict-prompt"]')).toBe(
      drawn.promptFill,
    );
    // **The strip loses its conditions line**: when, then how far and how
    // fast — the board's two cells. The values are this run's.
    const strip = await cellsOf(page, '[data-part="run-strip"]');
    expect(strip).toHaveLength(drawn.strip.length);
    expect(strip[1]).toMatch(/\/MI$/u);
    expect(drawn.strip[1]).toMatch(/\/MI$/u);
  } finally {
    await removeSeeded(rows);
  }
});

test("D for someone else's entry: strip with badge, note, kit, tags, Useful, Report", async ({
  page,
  baseURL,
}) => {
  if (baseURL === undefined) throw new Error("no baseURL");

  await openBoard(page, BOARD, baseURL);
  const drawn = {
    parts: await entryParts(page, `[data-screen-label="${THEIRS}"]`),
    badgeFill: await fillOf(page, part(THEIRS, "verdict-badge")),
    tagFills: await fillsOf(page, part(THEIRS, "tags")),
    kit: await cellsOf(page, part(THEIRS, "kit")),
  };
  expect(drawn.parts, "the board has no D for someone else").not.toHaveLength(
    0,
  );

  const rows = seeded();
  const runner = await seedRunner(rows, `D runner ${String(Date.now())}`);
  const { entryId } = await seedEntry(rows, {
    userId: runner,
    place: { lat: 62.12, lng: 13.21 },
    startedAt: nowSeconds() - 5 * 3600,
    feelsLikeC: 8,
    verdict: 1,
    caption: "Wore the shell for a forecast that never showed up.",
    tags: ["overheated_late", "chafed"],
  });

  try {
    await page.setViewportSize(PHONE);
    await page.goto(`/feed/entry/${entryId}`);
    await hydrated(page);

    // **One known gap, and it is a question rather than drift**: the board
    // puts a per-item flag on a stranger's entry; `docs/contracts.md`
    // says per-item flags are never public. The contract holds until the
    // owner says otherwise, so the flag is the one part not compared.
    expect(await entryParts(page, "body")).toEqual(
      drawn.parts.filter((name) => name !== "item-flag"),
    );
    expect(await fillOf(page, '[data-part="verdict-badge"]')).toBe(
      drawn.badgeFill,
    );
    // Tags on the bar-track fill, so they do not read as tappable.
    expect(await fillsOf(page, '[data-part="tags"]')).toEqual(drawn.tagFills);
    const kit = await cellsOf(page, '[data-part="kit"]');
    expect(kit[0]).toBe(drawn.kit[0]);
  } finally {
    await removeSeeded(rows);
  }
});
