import { expect, test } from "@playwright/test";
import type { Page } from "@playwright/test";
import { inArray, sql } from "drizzle-orm";

import {
  outfitEntries,
  outfitEntryItems,
  runs,
  wardrobeItems,
} from "../../src/db/schema-core";
import { manualConditions } from "../../src/db/schema-weather";
import { newUlid } from "../../src/lib/ids";
import { nowSeconds } from "../../src/lib/now";
import { storageStateFor } from "../support/accounts";
import { cellsOf, hydrated, openBoard } from "../support/conformance";
import { withLocalDb } from "../support/local-db";
import { closetUserId } from "./closet-seed";
import { entryAudienceColumns } from "../support/audience";

/**
 * Round 26's closet frames — "Y Delete with runs", "F Photo failed" and
 * "F Add garment desk" (task 128 · SAF-16, 17, 18) — against the build.
 *
 * **The board's own garments are seeded**, so the words in each region
 * compare as words. Known gaps, each named and taken out of the board's
 * side before comparing, never waved through by loosening the reader:
 *
 * - **`· HALF-ZIP`** in F's kicker and the rail's title is the garment
 *   type. F asks no type (a garment's type comes from its product), so the
 *   build names the category alone.
 * - **The photo's reason.** The board's is a type refusal
 *   ("IMG_2231.HEIC isn't…"), which a browser cannot send any more: W3's
 *   canvas re-encodes every photo. The spec reaches the state the way a
 *   runner does, by a dropped connection, so the reason reads "Your
 *   connection dropped." — and Try again is offered, as the board draws.
 * - **`RETIRED MAR 2026`** on the rail is month and year; the build
 *   dates a retirement as the closet does everywhere, month and day.
 *
 * A named piece is linked to a product (any id will do: nothing here reads
 * the product), because that is what makes the closet call it by brand
 * and name — as a save through F does.
 */
test.use({ storageState: storageStateFor("closet") });

const BOARD = "Round 26 Rulings.dc.html";

function frame(label: string): string {
  return `[data-screen-label="${label}"]`;
}

const created: {
  itemIds: string[];
  runIds: string[];
  entryIds: string[];
} = { itemIds: [], runIds: [], entryIds: [] };

async function seedPiece(
  values: Omit<typeof wardrobeItems.$inferInsert, "id" | "userId">,
): Promise<string> {
  const userId = await closetUserId();
  const id = newUlid();
  created.itemIds.push(id);
  await withLocalDb(async ({ core }) => {
    await core
      .insert(wardrobeItems)
      .values({ id, userId, origin: "manual", ...values });
  });
  return id;
}

/**
 * `count` verdicted runs in the piece — `dialed` of them dialed — each in
 * a band the runner set, spread over `bands` 5 °C bands.
 */
async function wear(
  itemId: string,
  options: { count: number; dialed: number; bands: number },
): Promise<void> {
  const userId = await closetUserId();
  const startedAt = nowSeconds() - 60 * 86_400;
  await withLocalDb(async ({ core, weather }) => {
    for (let index = 0; index < options.count; index += 1) {
      const runId = newUlid();
      const entryId = newUlid();
      created.runIds.push(runId);
      created.entryIds.push(entryId);
      await core.insert(runs).values({
        id: runId,
        userId,
        title: "Conformance",
        startedAt: startedAt + index * 3600,
        durationS: 2400,
        distanceM: 8000,
        lat: 44.98,
        lng: -93.27,
        source: "manual",
        indoor: false,
      });
      await weather.insert(manualConditions).values({
        runId,
        tempC: 1 + (index % options.bands) * 5,
        setAt: startedAt,
      });
      await core.insert(outfitEntries).values({
        id: entryId,
        userId,
        runId,
        verdict: index < options.dialed ? 0 : -1,
        ...entryAudienceColumns("private"),
        createdAt: startedAt + index * 3600,
      });
      await core.insert(outfitEntryItems).values({ entryId, itemId });
    }
  });
}

test.afterAll(async () => {
  await withLocalDb(async ({ core, weather }) => {
    if (created.entryIds.length > 0) {
      await core
        .delete(outfitEntryItems)
        .where(inArray(outfitEntryItems.entryId, created.entryIds));
      await core
        .delete(outfitEntries)
        .where(inArray(outfitEntries.id, created.entryIds));
    }
    if (created.runIds.length > 0) {
      await weather
        .delete(manualConditions)
        .where(inArray(manualConditions.runId, created.runIds));
      await core.delete(runs).where(inArray(runs.id, created.runIds));
    }
    if (created.itemIds.length > 0) {
      await core
        .delete(wardrobeItems)
        .where(inArray(wardrobeItems.id, created.itemIds));
    }
  });
});

async function drawn(page: Page, baseURL: string, selector: string) {
  await openBoard(page, BOARD, baseURL);
  const cells = await cellsOf(page, selector);
  expect(cells, `the board has nothing at ${selector}`).not.toHaveLength(0);
  return cells;
}

test("Y · deleting a piece with runs is round 26's sheet, word for word", async ({
  page,
  baseURL,
}) => {
  if (baseURL === undefined) throw new Error("no baseURL");
  const itemId = await seedPiece({
    category: "shoes",
    brand: "Nike",
    name: "Pegasus 40",
    createdAt: nowSeconds() - 90 * 86_400,
  });
  await wear(itemId, { count: 38, dialed: 30, bands: 4 });

  const board = await drawn(
    page,
    baseURL,
    `${frame("Y Delete with runs")} > div:nth-child(2)`,
  );

  await page.setViewportSize({ width: 390, height: 900 });
  await page.goto(`/closet/${itemId}`);
  await hydrated(page);
  await page.getByRole("button", { name: "Delete" }).click();
  const sheet = '[data-part="sheet"][data-state="delete-with-runs"]';
  await expect(page.locator(sheet)).toBeVisible();
  // The band count is asked for when the sheet opens, not with the page,
  // so its row arrives a moment after the sheet does.
  await expect(
    page.locator(sheet).getByText("Its record in 4 bands"),
  ).toBeVisible();

  // `PendingLabel` keeps each action's in-flight label in the DOM, hidden
  // until needed, so it is taken off before the words are compared.
  const built = await cellsOf(page, sheet);
  expect(
    built.map((cell) => cell.replace(/ \[ [A-Z]+ \]$/u, "")),
  ).toStrictEqual(board);
});

test("F · saved with its photo refused is round 26's band and Done", async ({
  page,
  baseURL,
}) => {
  if (baseURL === undefined) throw new Error("no baseURL");
  const band = await drawn(
    page,
    baseURL,
    `${frame("F Photo failed")} [data-part="control-failure"]`,
  );
  const identity = await cellsOf(
    page,
    `${frame("F Photo failed")} > div > div:nth-child(2)`,
  );
  const withoutType = identity.map((cell) => cell.replace(" · HALF-ZIP", ""));

  await page.setViewportSize({ width: 390, height: 900 });
  await page.goto("/closet/new");
  await hydrated(page);
  await page.getByLabel("Brand").fill("Janji");
  await page.getByLabel("Model / name").fill("Rover Half-zip");
  await page.setInputFiles('[data-part="photo-well"] input[type="file"]', {
    name: "rover.png",
    mimeType: "image/png",
    buffer: Buffer.from(
      "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
      "base64",
    ),
  });
  await expect(page.locator('[data-part="photo-well"]')).toHaveAttribute(
    "data-state",
    "filled",
    { timeout: 20_000 },
  );
  await page.route("**/_serverFn/**", async (route) => {
    const type = route.request().headers()["content-type"] ?? "";
    await (type.includes("multipart/form-data")
      ? route.abort("internetdisconnected")
      : route.continue());
  });
  await page.getByRole("button", { name: "Add to closet" }).click();
  const built = '[data-part="failure-band"]';
  await expect(page.locator(built)).toBeVisible();
  expect(new URL(page.url()).pathname).toBe("/closet/new");

  const builtBand = await cellsOf(page, built);
  // The reason is the known gap above; the rest is compared as drawn.
  expect(builtBand.toSpliced(2, 1)).toStrictEqual(band.toSpliced(2, 1));
  expect(builtBand[2]).toBe("YOUR CONNECTION DROPPED.");
  const heading = await cellsOf(page, '[data-part="primary"] > div:has(h1)');
  expect(heading).toStrictEqual(withoutType);

  // Done goes to the garment the save made — and names it, so it can be
  // taken back out and the next run starts clean.
  await page.unroute("**/_serverFn/**");
  await page.getByRole("button", { name: "Done" }).click();
  await page.waitForURL(/\/closet\/[0-9A-Z]{26}$/u);
  created.itemIds.push(new URL(page.url()).pathname.split("/").at(-1) ?? "");
});

test("F at the desk · the rail card is round 26's, newest first, marked", async ({
  page,
  baseURL,
}) => {
  if (baseURL === undefined) throw new Error("no baseURL");
  const now = nowSeconds();
  const uniqlo = await seedPiece({
    category: "top",
    name: "Uniqlo quarter-zip",
    createdAt: now + 86_400,
  });
  await wear(uniqlo, { count: 3, dialed: 0, bands: 1 });
  await withLocalDb(async ({ core }) => {
    await core
      .update(outfitEntries)
      .set({ verdict: sql`NULL` })
      .where(inArray(outfitEntries.id, created.entryIds.slice(-3)));
  });
  const rover = await seedPiece({
    category: "top",
    brand: "Janji",
    productId: newUlid(),
    name: "Rover Half-zip",
    retired: true,
    retiredAt: now - 86_400,
    createdAt: now + 2 * 86_400,
  });
  await wear(rover, { count: 12, dialed: 6, bands: 2 });
  const harrier = await seedPiece({
    category: "top",
    brand: "Tracksmith",
    productId: newUlid(),
    name: "Harrier",
    estTempLowC: 38,
    estTempHighC: 46,
    createdAt: now + 3 * 86_400,
  });
  await wear(harrier, { count: 41, dialed: 8, bands: 3 });
  await withLocalDb(async ({ core }) => {
    // 8 of 9 verdicts dialed: the rest of the 41 were never judged.
    await core
      .update(outfitEntries)
      .set({ verdict: sql`NULL` })
      .where(inArray(outfitEntries.id, created.entryIds.slice(-32)));
  });

  const rail = `${frame("F Add garment desk")} [data-part="rail"] > div`;
  const board = await drawn(page, baseURL, rail);
  const [drawnTitle = "", ...drawnRows] = board;

  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto("/closet/new");
  await hydrated(page);
  await page.getByLabel("Brand").fill("Janji");
  await page.getByLabel("Model / name").fill("Rover Half-zip");
  const card = '[data-part="rail"] section';
  await expect(
    page.locator(card).getByText("Same name · Retired"),
  ).toBeVisible();

  expect(await cellsOf(page, `${card} > h2`)).toStrictEqual([
    drawnTitle.replace(" · HALF-ZIP", ""),
  ]);
  const rows = await cellsOf(page, `${card} ul`);
  // The closet may hold other tops from other specs; the board's three
  // are seeded newest (dated ahead, on purpose), so they lead.
  expect(
    rows.slice(0, 3).map((row) => row.replace(/RETIRED [A-Z]{3} \d+ /u, "")),
  ).toStrictEqual(
    drawnRows.map((row) => row.replace(/RETIRED [A-Z]{3} \d{4} /u, "")),
  );
});
