/**
 * Covers, beside `closet.journey.spec.ts`, what happens to a piece once it
 * is saved: §AG (what a garment is made of) with round 43 #94's specs from
 * the page; round 26 #4 (F · saved, photo refused) with R-114 (the rail
 * listing a save F kept); and round 26 #3 (Y · delete with runs).
 *
 * The closet account is the journey's too, and the journey opens on an
 * empty closet: every test here removes what it made — the rows it seeded
 * by their ids, and what a save made by its name.
 */
import { inArray } from "drizzle-orm";

import {
  outfitEntries,
  outfitEntryItems,
  runs,
} from "../../src/db/schema-core";
import { manualConditions } from "../../src/db/schema-weather";
import { newUlid } from "../../src/lib/ids";
import { nowSeconds } from "../../src/lib/now";
import { closetUserId } from "../conformance/closet-seed";
import { storageStateFor } from "../support/accounts";
import { expect, test } from "../support/a11y";
import { hydrated } from "../support/demo";
import { withLocalDb } from "../support/local-db";
import {
  PNG_1X1,
  itemsNamed,
  removeItems,
  removeProductPieces,
  seedProductPiece,
} from "./closet-support";

test.use({ storageState: storageStateFor("closet") });

/**
 * Whether a server-function request is the photo's upload: the only one
 * sent as multipart form data, so the spec can drop that one alone.
 */
function isPhotoUpload(contentType: string | undefined): boolean {
  return contentType?.includes("multipart/form-data") === true;
}

test("§AG · what a piece is made of, from its product page, in grey", async ({
  page,
}) => {
  // Composition belongs to the product, not to the runner's copy —
  // enrichment writes it from a brand's page, so the spec writes the rows
  // enrichment would have. Seeded through Drizzle and the real schema.
  const piece = await seedProductPiece(
    {
      category: "top",
      type: "jacket",
      layer: "outer",
      weight: "light",
      brand: "Patagonia",
      name: "Houdini Jacket",
      productUrl: "https://patagonia.com/houdini",
      origin: "manual",
    },
    {
      sourceUrl: "https://patagonia.com/houdini",
      // What a read of the pasted page leaves (round 43 #94): done, with
      // the columns it wrote, and a fabric the runner left empty.
      extractionStatus: "done",
      extracted: JSON.stringify({
        rung: "jsonld",
        found: { fabric: "synthetic" },
        written: { fabric: "synthetic", fabricComposition: "100% nylon" },
      }),
      fabric: "synthetic",
      fabricComposition: "100% nylon, GORE-TEX",
      fabricParts: JSON.stringify([
        { part: "Body", materials: [{ material: "nylon", pct: 100 }] },
        {
          part: "Underarm",
          materials: [
            { material: "polyester", pct: 87 },
            { material: "elastane", pct: 13 },
          ],
        },
      ]),
    },
  );
  try {
    await page.goto(`/closet/${piece.itemId}`);
    await hydrated(page);
    await expect(page.locator("[data-part='shop-page'] p")).toHaveText(
      "[Specs from patagonia.com] · Grey values are from the page",
    );
    // The fabric the page lent is grey; the runner's own weight stays ink.
    await expect(
      page
        .locator("[data-part='composition']")
        .getByText("synthetic", { exact: true }),
    ).toHaveClass(/text-quiet/);
    await expect(
      page
        .locator("[data-part='composition']")
        .getByText("lightweight", { exact: true }),
    ).toHaveClass(/text-ink/);
    await expect(page.getByText("Composition · from")).toBeVisible();
    await expect(page.getByText("Body")).toBeVisible();
    await expect(page.getByText("87% polyester · 13% elastane")).toBeVisible();
    await expect(page.getByText("As labelled by Patagonia")).toBeVisible();
  } finally {
    await removeProductPieces([piece]);
  }
});

test("F · the photo is refused and the piece is kept; deleting it with runs asks to retire it", async ({
  page,
}, testInfo) => {
  // Two blur passes and a retry: more than the default 30s on a busy box.
  testInfo.setTimeout(90_000);
  const userId = await closetUserId();
  const runIds: string[] = [];
  const entryIds: string[] = [];
  try {
    // ---- Round 26 #4 · saved, photo refused -----------------------------
    // A new piece, and its photo lost to a dropped connection: the save is
    // not undone, the fields go, and Try again re-sends the same file.
    await page.goto("/closet/new");
    await hydrated(page);
    const rail = page.locator("[data-part='rail']");
    await page.getByLabel("Category").selectOption("top");
    await page.getByRole("radio", { name: "Jacket" }).check();
    await page.getByLabel("Brand").fill("Patagonia");
    await page.getByLabel("Model / name").fill("Houdini Air");
    await expect(rail.getByText("Same name")).toHaveCount(0);
    await expect(rail.getByText("Patagonia Houdini Air")).toHaveCount(0);
    await page.setInputFiles('[data-part="photo-well"] input[type="file"]', {
      name: "houdini-air.png",
      mimeType: "image/png",
      buffer: PNG_1X1,
    });
    // W3 waits for the runner (round 28 #5): nothing is attached until
    // Use this photo, which waits behind aria-disabled while it blurs.
    const well = page.locator("[data-part='photo-well']");
    await page
      .getByRole("button", { name: "Use this photo" })
      .click({ timeout: 20_000 });
    await expect(well).toHaveAttribute("data-state", "filled", {
      timeout: 20_000,
    });
    let hasDropped = false;
    await page.route("**/_serverFn/**", async (route) => {
      if (
        !hasDropped &&
        isPhotoUpload(route.request().headers()["content-type"])
      ) {
        hasDropped = true;
        await route.abort("internetdisconnected");
        return;
      }
      await route.continue();
    });
    await page.getByRole("button", { name: "Add to closet" }).click();

    const band = page.locator("[data-part='failure-band']");
    await expect(band).toContainText("Photo not added");
    await expect(band).toContainText("Garment saved, photo didn't. Try again?");
    await expect(band).toContainText("Your connection dropped.");
    await expect(
      page.getByRole("heading", { level: 1, name: "Patagonia Houdini Air" }),
    ).toBeVisible();
    await expect(
      page.getByText("Saved to closet · Top · Jacket"),
    ).toBeVisible();
    await expect(page.getByLabel("Model / name")).toHaveCount(0);
    // R-114: the rail stays, and the piece the save made is one of its rows.
    await expect(rail.getByText("Patagonia Houdini Air")).toBeVisible();
    await expect(page.getByLabel("Pick another")).toBeAttached();
    await expect(page.getByRole("button", { name: "Done" })).toBeVisible();

    // Try again sends the same photo, and lands on the piece.
    await page.unroute("**/_serverFn/**");
    await band.getByRole("button", { name: "Try again" }).click();
    await expect(
      page.getByRole("heading", { level: 1, name: "Patagonia Houdini Air" }),
    ).toBeVisible();
    await expect(well.locator('img[src^="/closet/photo/"]')).toBeVisible();
    const [itemId = ""] = await itemsNamed("Houdini Air");

    // ---- Round 26 #3 · deleting a piece with runs -------------------------
    // Three runs in the Houdini Air, two of them in one 5 °C band and one in
    // the next: seeded as rows, with the bands the runner set, because what
    // the sheet counts is history and history is not typed into a form.
    await withLocalDb(async ({ core, weather }) => {
      const startedAt = nowSeconds() - 3 * 86_400;
      for (const [index, tempC] of [6, 8, 12].entries()) {
        const runId = newUlid();
        const entryId = newUlid();
        runIds.push(runId);
        entryIds.push(entryId);
        await core.insert(runs).values({
          id: runId,
          userId,
          title: "Demo run",
          startedAt: startedAt + index * 86_400,
          durationS: 2400,
          distanceM: 8000,
          lat: 44.98,
          lng: -93.27,
          source: "manual",
          indoor: false,
        });
        await weather
          .insert(manualConditions)
          .values({ runId, tempC, setAt: startedAt });
        await core.insert(outfitEntries).values({
          id: entryId,
          userId,
          runId,
          verdict: 0,
          audience: "private",
          createdAt: startedAt + index * 86_400,
        });
        await core.insert(outfitEntryItems).values({ entryId, itemId });
      }
    });

    await page.reload();
    await hydrated(page);
    await page.getByRole("button", { name: "Delete" }).click();
    const worn = page.locator(
      "[data-part='sheet'][data-state='delete-with-runs']",
    );
    // The heading is the sheet's own, over the body (R55·173).
    await expect(
      page.locator("dialog[open]").getByRole("heading", {
        name: "Delete the Houdini Air? Retire it instead.",
      }),
    ).toBeVisible();
    await expect(worn.getByText(/^It's on 3 runs\./u)).toBeVisible();
    await expect(
      worn.getByText("It comes off the kit of all 3 runs"),
    ).toBeVisible();
    await expect(worn.getByText("Its record in 2 bands")).toBeVisible();
    await expect(worn.getByRole("button", { name: "Cancel" })).toBeFocused();

    // Delete it and its record: straight through, back to C.
    await worn
      .getByRole("button", { name: "Delete it and its record" })
      .click();
    await expect(
      page.getByRole("status").filter({ hasText: "deleted" }),
    ).toHaveText("Houdini Air deleted.");
    await expect(
      page.getByRole("link", { name: /Patagonia Houdini Air/ }),
    ).toHaveCount(0);
  } finally {
    // Each run's id and its entry's are minted together, so one list being
    // empty means both are: nothing was seeded.
    if (runIds.length > 0) {
      await withLocalDb(async ({ core, weather }) => {
        await core
          .delete(outfitEntryItems)
          .where(inArray(outfitEntryItems.entryId, entryIds));
        await core
          .delete(outfitEntries)
          .where(inArray(outfitEntries.id, entryIds));
        await weather
          .delete(manualConditions)
          .where(inArray(manualConditions.runId, runIds));
        await core.delete(runs).where(inArray(runs.id, runIds));
      });
    }
    await removeItems(await itemsNamed("Houdini Air"));
  }
});
