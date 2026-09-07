/**
 * Covers: A3 (log the verdict) — choosing a verdict, flagging a kit item,
 * and attaching a photo, then seeing it on the entry. One journey, one
 * video.
 *
 * Why this exists separately from feed.demo.spec.ts: that one is the
 * *reader's* journey (follow, browse, open, mark useful) and its Covers
 * header claims A3 only as a display. Nothing demonstrated the writer's
 * half, which is where the photo upload lives.
 *
 * The upload is the point. It moved from base64-over-JSON to multipart
 * FormData, and the only honest way to know that works is to watch a real
 * file go up and come back as a rendered image.
 */
import { eq } from "drizzle-orm";

import { outfitEntries, outfitEntryItems, runs, wardrobeItems } from "../../src/db/schema-core";
import { user } from "../../src/db/schema-auth";
import { newUlid } from "../../src/lib/ids";
import { expect, test } from "../support/demo";
import { withLocalDb } from "../support/local-db";

/** Layout stamps html[data-hydrated] once React attaches; driving
 *  controlled inputs before that races hydration's state reset. */
async function hydrated(page: import("@playwright/test").Page): Promise<void> {
  await page
    .locator('html[data-hydrated="true"]')
    .waitFor({ state: "attached" });
}

/**
 * A real 1x1 PNG. Small enough to keep the recording quick, and a genuine
 * decodable image rather than random bytes with an image/png label — the
 * upload path stores what it is given, so a fake would still "work" and
 * would prove less.
 */
const PNG_1X1 = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
  "base64",
);

test("log a verdict on your own run: pick it, flag an item, attach a photo", async ({
  page,
}, testInfo) => {
  // Paced runs (npm run demo) need headroom; at full speed this is quick.
  testInfo.setTimeout(150_000);

  const suffix = String(Date.now());
  const email = `verdict-${suffix}@example.com`;
  const itemId = newUlid();
  const runId = newUlid();
  const entryId = newUlid();

  await page.goto("/auth/signup");
  await hydrated(page);
  await page.getByLabel("Name").fill("Demo Runner");
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill("a-long-enough-password");
  await page.getByRole("button", { name: "Sign up" }).click();
  await expect(page.getByText(email)).toBeVisible({ timeout: 15_000 });

  // Seed a run and an un-verdicted entry owned by the account that just
  // signed up — the verdict screen is owner-only, so the rows have to
  // belong to this user rather than a fixture one.
  const startedAt = Math.floor(Date.now() / 1000) - 3600;
  await withLocalDb(async ({ core }) => {
    const [row] = await core
      .select({ id: user.id })
      .from(user)
      .where(eq(user.email, email))
      .limit(1);
    if (!row) throw new Error("signup did not create a user row");

    await core.insert(wardrobeItems).values({
      id: itemId,
      userId: row.id,
      name: "Houdini Jacket",
      brand: "Patagonia",
      category: "top",
      layer: "outer",
      createdAt: startedAt,
    });
    await core.insert(runs).values({
      id: runId,
      userId: row.id,
      title: "Riverside loop",
      startedAt,
      durationS: 2700,
      distanceM: 8000,
      source: "manual",
      indoor: 0,
      weatherStatus: "attached",
      lat: 45.52,
      lng: -122.68,
    });
    await core.insert(outfitEntries).values({
      id: entryId,
      userId: row.id,
      runId,
      isPublic: 1,
      createdAt: startedAt,
    });
    await core.insert(outfitEntryItems).values({ entryId, itemId });
  });

  await page.goto(`/feed/verdict/${entryId}`);
  await hydrated(page);

  // A3: the five-point scale, coldest to warmest, from the one shared
  // verdictScale rather than a per-screen copy.
  await page.getByRole("button", { name: "A bit cold" }).click();

  // Per-item signal is a flag, never a second verdict (CLAUDE.md).
  await page.getByRole("combobox").first().selectOption("not_enough");

  // The upload under test: a real file, streamed as multipart.
  await page.setInputFiles('input[type="file"]', {
    name: "kit.png",
    mimeType: "image/png",
    buffer: PNG_1X1,
  });

  // It came back as a stored key and renders through the owner-scoped
  // photo route — proof the round trip worked, not just that the POST
  // returned.
  await expect(page.locator('img[src^="/feed/photo/"]')).toBeVisible({
    timeout: 15_000,
  });

  await page.getByRole("button", { name: "Save verdict" }).click();

  // Landing back on the entry with the verdict recorded.
  await expect(page.getByText("[A bit cold]")).toBeVisible({ timeout: 15_000 });
});
