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
  BOARD_MORNING,
  gpx,
  hydrated,
  lookOf,
  seedRun,
  unseed,
  userIdOf,
} from "./logging-fixtures";

/**
 * A1 against its drawings: at rest (Product Screens, "A1 Upload"), and the
 * two outcomes round 22 drew because the import status page was hiding
 * them — "A1 Parse failed" and "A1 Duplicate" (Round 22 Coverage).
 *
 * Regions, not screens, as the A3 spec does: the drop zone, the field
 * message, the parsed card and the primary. Where the board's data is
 * fake — a filename, a date — the file is named and the run seeded to
 * match it, so the words compare too.
 */
test.use({ storageState: storageStateFor("run-logging") });

const ROUND_22 = "Round 22 Coverage.dc.html";

const DROP = '[data-part="drop-zone"]';

test.describe("A1 · upload", () => {
  let seeded: Seeded;

  test.beforeEach(async () => {
    seeded = {
      userId: await userIdOf("run-logging"),
      runIds: [],
      itemIds: [],
      entryIds: [],
    };
    await unseed(seeded);
  });

  test.afterEach(async () => {
    await unseed(seeded);
  });

  test("at rest, the drop zone says what the board says", async ({
    page,
    baseURL,
  }) => {
    if (baseURL === undefined) throw new Error("no baseURL");
    await openBoard(page, "Product Screens.dc.html", baseURL);
    const drawn = await signatureOf(page, part("A1 Upload", "drop-zone"));
    const drawnLook = await lookOf(page, part("A1 Upload", "drop-zone"));
    expect(drawn, "the board has no A1 drop zone").not.toHaveLength(0);

    await page.setViewportSize({ width: 390, height: 900 });
    await page.goto("/runs/new");
    await hydrated(page);

    expect(await signatureOf(page, DROP)).toEqual(drawn);
    const built = await lookOf(page, DROP);
    expect(built.borderStyle).toBe(drawnLook.borderStyle);
    // **The contract wins here, by ruling.** The board's dashes are
    // #B9B8AE, which is not a T1 light-ground value (it resolves nearest to
    // --quiet); `ui/FileWell` draws them --hairline-2, and the coordinator
    // ruled that stays (contracts outrank artboards for values). Pinned
    // both ways, so a change on either side is noticed rather than drifting.
    expect(colorRole(drawnLook.borderColor)).toBe("--quiet");
    expect(colorRole(built.borderColor)).toBe("--hairline-2");
  });

  test("a file with no track marks the drop zone, and says so beneath it", async ({
    page,
    baseURL,
  }) => {
    if (baseURL === undefined) throw new Error("no baseURL");
    const label = "A1 Parse failed";
    await openBoard(page, ROUND_22, baseURL);
    const drawnZone = await signatureOf(page, part(label, "drop-zone"));
    const drawnZoneLook = await lookOf(page, part(label, "drop-zone"));
    const drawnMessageLook = await lookOf(page, part(label, "field-message"));
    const drawnMessageText = await page.textContent(
      part(label, "field-message"),
    );
    expect(
      drawnZone,
      "the board has no parse-failed drop zone",
    ).not.toHaveLength(0);

    await page.setViewportSize({ width: 390, height: 900 });
    await page.goto("/runs/new");
    await hydrated(page);
    await page.setInputFiles(`${DROP} input[type="file"]`, {
      name: "MORNING_RUN.GPX",
      mimeType: "application/gpx+xml",
      buffer: gpx(BOARD_MORNING - 86_400 * 3, 1),
    });

    const message = page.locator("#drop-zone-message");
    await expect(message).toBeVisible({ timeout: 20_000 });
    // The words are the board's, file name and all.
    await expect(message).toHaveText((drawnMessageText ?? "").trim());
    const messageLook = await lookOf(page, "#drop-zone-message");
    expect(colorRole(messageLook.fill)).toBe(colorRole(drawnMessageLook.fill));
    // The drop zone still reads as the board's, and is marked as the
    // board marks it: solid, in ink.
    expect(await signatureOf(page, DROP)).toEqual(drawnZone);
    const zone = await lookOf(page, DROP);
    expect(zone.borderStyle).toBe(drawnZoneLook.borderStyle);
    expect(colorRole(zone.borderColor)).toBe(
      colorRole(drawnZoneLook.borderColor),
    );
    await expect(page.locator(DROP)).toHaveAttribute("data-state", "error");
  });

  test("a run already logged is a receipt in the card's place, and opens it in ink", async ({
    page,
    baseURL,
  }) => {
    if (baseURL === undefined) throw new Error("no baseURL");
    const label = "A1 Duplicate";
    await openBoard(page, ROUND_22, baseURL);
    const drawnCard = await signatureOf(page, part(label, "parsed-card"));
    const drawnPrimaryLook = await lookOf(page, part(label, "primary-action"));
    expect(drawnCard, "the board has no duplicate card").not.toHaveLength(0);

    // The run the file repeats, logged already on the board's morning.
    await seedRun(seeded, { observed: true, weatherStatus: "attached" });

    await page.setViewportSize({ width: 390, height: 900 });
    await page.goto("/runs/new");
    await hydrated(page);
    await page.setInputFiles(`${DROP} input[type="file"]`, {
      name: "MORNING_RUN_0829.GPX",
      mimeType: "application/gpx+xml",
      buffer: gpx(BOARD_MORNING, 6),
    });

    const card = '[data-slot="parsed-card"][data-state="duplicate"]';
    await expect(page.locator(card)).toBeVisible({ timeout: 20_000 });
    const built = await signatureOf(page, card);

    // Row for row: the file and REPLACE, the kicker, the headline, the
    // facts line, the sentence. The headline and the sentence are the
    // board's words; the facts line is the run's day and time, which the
    // app writes day-first ("Sat 29 Aug") as every other screen does.
    expect(built).toHaveLength(drawnCard.length);
    expect(built[0]).toEqual(drawnCard[0]);
    expect(built[1]).toEqual(drawnCard[1]);
    expect(built[2]).toEqual(drawnCard[2]);
    expect(built[3]?.length).toBe(drawnCard[3]?.length);
    expect(built[3]?.at(-1)).toBe(drawnCard[3]?.at(-1));
    expect(built[4]).toEqual(drawnCard[4]);

    // The primary is ink, not the log verb's pink.
    const primary = page.getByRole("link", { name: "Open that run" });
    await expect(primary).toBeVisible();
    const fill = await primary.evaluate(
      (element) => getComputedStyle(element).backgroundColor,
    );
    expect(colorRole(fill)).toBe(colorRole(drawnPrimaryLook.fill));
  });
});
