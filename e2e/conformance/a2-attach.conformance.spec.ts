import type { Page, Route } from "@playwright/test";
import { expect, test } from "@playwright/test";

import { storageStateFor } from "../support/accounts";
import {
  colorRole,
  openBoard,
  part,
  signatureOf,
} from "../support/conformance";
import type { Seeded } from "./logging-fixtures";
import {
  hydrated,
  lookOf,
  seedItem,
  seedRun,
  unseed,
  userIdOf,
} from "./logging-fixtures";

/**
 * A2 before a suggestion, against round 22's two frames: "A2 Waiting" —
 * only most-likely waits, the rest is A2 at rest from the first frame —
 * and "A2 No suggestion", one line and no card.
 *
 * Compared by region: the header's sub-line, most-likely, and the
 * primary. The closet picker is compared by its heading only: the board
 * draws it unfiltered while waiting because its band had not arrived,
 * where ours knows the run's band from the first frame (the run's own
 * conditions come with the route), so the filter is already on — a
 * difference recorded in the PR's design deltas rather than hidden here.
 */
test.use({ storageState: storageStateFor("run-logging") });

const ROUND_22 = "Round 22 Coverage.dc.html";

/**
 * The server function A2 waits on, by name. TanStack Start addresses a
 * server function by an id that encodes where it was declared, so the
 * name is in the URL once the last segment is decoded.
 */
function isPrefill(url: string): boolean {
  const segment = new URL(url).pathname.split("/").pop() ?? "";
  const decoded = Buffer.from(segment, "base64url").toString("utf8");
  return `${url} ${decoded}`.includes("prefillForRun");
}

/**
Holds the suggestion forever — "A2 Waiting" — and lets everything else by.
*/
async function holdTheSuggestion(page: Page): Promise<void> {
  await page.route("**/_serverFn/**", async (route: Route) => {
    if (isPrefill(route.request().url())) return;
    await route.continue();
  });
}

/**
Apostrophes as typed, so a board's `'` and our `’` compare as one.
*/
function plain(rows: readonly (readonly string[])[]): string[][] {
  return rows.map((row) => row.map((cell) => cell.replaceAll("’", "'")));
}

const MOST_LIKELY = '[data-slot="most-likely"]';

test.describe("A2 · before a suggestion", () => {
  let seeded: Seeded;
  let runId: string;

  test.beforeEach(async () => {
    seeded = {
      userId: await userIdOf("run-logging"),
      runIds: [],
      itemIds: [],
      entryIds: [],
    };
    await unseed(seeded);
    runId = await seedRun(seeded, {
      observed: true,
      weatherStatus: "attached",
    });
    await seedItem(seeded, "Conformance top", "top");
    await seedItem(seeded, "Conformance tights", "bottom");
  });

  test.afterEach(async () => {
    await unseed(seeded);
  });

  test("waiting: only most-likely waits, in the board's words and frame", async ({
    page,
    baseURL,
  }) => {
    if (baseURL === undefined) throw new Error("no baseURL");
    const label = "A2 Waiting";
    await openBoard(page, ROUND_22, baseURL);
    const drawnHeader = await signatureOf(page, part(label, "header"));
    const drawnWaiting = await signatureOf(page, part(label, "most-likely"));
    const drawnWaitingLook = await lookOf(page, part(label, "most-likely"));
    const drawnPrimary = await signatureOf(page, part(label, "primary-action"));
    const drawnPrimaryLook = await lookOf(page, part(label, "primary-action"));
    const drawnPicker = await signatureOf(page, part(label, "closet-picker"));
    expect(drawnWaiting, "the board has no waiting region").not.toHaveLength(0);

    await holdTheSuggestion(page);
    await page.setViewportSize({ width: 390, height: 900 });
    await page.goto(`/feed/attach/${runId}`);
    await hydrated(page);

    // The header's sub-line: "6.2 MI · 41°F DAMP · 0 PIECES".
    const header = await signatureOf(page, '[data-slot="header"]');
    expect(header.at(-1)).toEqual(drawnHeader.at(-1));

    const waiting = page.locator(MOST_LIKELY);
    await expect(waiting).toHaveAttribute("data-state", "waiting");
    await expect(waiting).toHaveAttribute("aria-busy", "true");
    expect(await signatureOf(page, MOST_LIKELY)).toEqual(drawnWaiting);
    const look = await lookOf(page, MOST_LIKELY);
    expect(colorRole(look.fill)).toBe(colorRole(drawnWaitingLook.fill));
    expect(look.borderStyle).toBe(drawnWaitingLook.borderStyle);
    expect(colorRole(look.borderColor)).toBe(
      colorRole(drawnWaitingLook.borderColor),
    );

    // The picker and the primary are there from the first frame.
    const picker = await signatureOf(page, '[data-slot="closet-picker"]');
    expect(picker[0]?.[0]).toBe(drawnPicker[0]?.[0]);
    expect(await signatureOf(page, '[data-slot="primary-action"]')).toEqual(
      drawnPrimary,
    );
    const primary = await lookOf(page, '[data-slot="primary-action"]');
    expect(colorRole(primary.fill)).toBe(colorRole(drawnPrimaryLook.fill));
  });

  test("no suggestion: one line, no card, and the picker loses its OR", async ({
    page,
    baseURL,
  }) => {
    if (baseURL === undefined) throw new Error("no baseURL");
    const label = "A2 No suggestion";
    await openBoard(page, ROUND_22, baseURL);
    const drawnNone = await signatureOf(page, part(label, "most-likely"));
    const drawnNoneLook = await lookOf(page, part(label, "most-likely"));
    const drawnPicker = await signatureOf(page, part(label, "closet-picker"));
    expect(drawnNone, "the board has no no-suggestion region").not.toHaveLength(
      0,
    );

    await page.setViewportSize({ width: 390, height: 900 });
    await page.goto(`/feed/attach/${runId}`);
    await hydrated(page);

    const none = page.locator(MOST_LIKELY);
    await expect(none).toHaveAttribute("data-state", "none", {
      timeout: 15_000,
    });
    expect(plain(await signatureOf(page, MOST_LIKELY))).toEqual(
      plain(drawnNone),
    );
    const look = await lookOf(page, MOST_LIKELY);
    expect(colorRole(look.fill)).toBe(colorRole(drawnNoneLook.fill));
    // "One line, no card": no box around it, a rule beneath.
    expect(look.borderStyle).toBe(drawnNoneLook.borderStyle);
    expect(look.ruleBelow).toBe(drawnNoneLook.ruleBelow);

    const picker = await signatureOf(page, '[data-slot="closet-picker"]');
    expect(picker[0]?.[0]).toBe(drawnPicker[0]?.[0]);
  });
});
