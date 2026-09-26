import { expect, test } from "@playwright/test";

import { storageStateFor } from "../support/accounts";
import { PHONE } from "../support/bars";
import {
  cellsOf,
  fillOf,
  hydrated,
  openBoard,
  part,
} from "../support/conformance";
import {
  feedUserId,
  folded,
  removeSeeded,
  seeded,
  seedRunner,
  unfollowEveryone,
} from "./feed-support";

/**
 * G and H — round 22's "G New account" and "H No public entries", drawn
 * with only what v1 stores. Zeros shown as zeros, one next step on G, and
 * an H that keeps its header and says it has nothing public.
 */
test.use({ storageState: storageStateFor("feed") });

const BOARD = "Round 22 Coverage.dc.html";
const G = "G New account";
const H = "H No public entries";

test("G on day one shows its counts at zero and one next step, as drawn", async ({
  page,
  baseURL,
}) => {
  if (baseURL === undefined) throw new Error("no baseURL");

  await openBoard(page, BOARD, baseURL);
  const drawn = {
    counts: await cellsOf(page, part(G, "counts")),
    entries: await cellsOf(page, `${part(G, "entries")}[data-state="empty"]`),
    primary: await fillOf(page, part(G, "primary-action")),
  };
  expect(drawn.counts, "the board has no G counts").not.toHaveLength(0);

  // Day one: no runs (the feed account logs none) and no follows.
  await unfollowEveryone(await feedUserId());
  await page.setViewportSize(PHONE);
  await page.goto("/feed/me");
  await hydrated(page);

  // **Counts show as zeros** — hiding them makes a profile look broken.
  expect(await cellsOf(page, '[data-part="counts"]')).toEqual(drawn.counts);
  // **One next step**, word for word, in the action pink.
  expect(
    folded(await cellsOf(page, '[data-part="entries"][data-state="empty"]')),
  ).toEqual(folded(drawn.entries));
  expect(
    await fillOf(page, '[data-part="entries"] [data-part="primary-action"]'),
  ).toBe(drawn.primary);
});

test("H with nothing public keeps its header and Follow, and says so plainly", async ({
  page,
  baseURL,
}) => {
  if (baseURL === undefined) throw new Error("no baseURL");

  await openBoard(page, BOARD, baseURL);
  const drawn = await cellsOf(
    page,
    `${part(H, "entries")}[data-state="empty"]`,
  );
  const drawnCounts = await page.locator(part(H, "counts")).count();
  expect(drawn, "the board has no empty H").not.toHaveLength(0);

  const rows = seeded();
  const runner = await seedRunner(rows, "Ravi K");
  try {
    await page.setViewportSize(PHONE);
    await page.goto(`/feed/u/${runner}`);
    await hydrated(page);

    await expect(page.getByRole("heading", { name: "Ravi K" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Follow" })).toBeVisible();
    // **No counts on H**, as drawn.
    await expect(page.locator('[data-part="counts"]')).toHaveCount(drawnCounts);

    const built = await cellsOf(
      page,
      '[data-part="entries"][data-state="empty"]',
    );
    // The lead, word for word; the second line names the runner, which is
    // data (the board's Ravi uses a first name v1 does not store).
    expect(built[0]).toBe(drawn[0]);
    expect(built[1]).toMatch(
      /^FOLLOW .+ AND THEIR SHARED RUNS WILL SHOW IN YOUR FEED\.$/u,
    );
    expect(drawn[1]).toMatch(
      /^FOLLOW .+ AND THEIR SHARED RUNS WILL SHOW IN YOUR FEED\.$/u,
    );
    // Report is the foot of the same block. Its words are the W1
    // trigger's, which lane 124 owns; its place is this screen's.
    expect(built).toHaveLength(drawn.length);
    await expect(
      page.locator('[data-part="entries"] > [data-part="report"]'),
    ).toHaveCount(1);
  } finally {
    await removeSeeded(rows);
  }
});
