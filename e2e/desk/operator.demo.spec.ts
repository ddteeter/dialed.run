/**
 * Covers: D0 (the Desk's shell) and Today, with D6 · Gave up as Today's
 * section (D-87; R-119) — one journey, one video.
 *
 * The journey needs `ADMIN_USER_IDS=e2e-desk-operator` in the dev server's
 * `.dev.vars`, which CI's e2e job writes (register R-72, PR #114). Locally,
 * put the same line in yours.
 *
 * Exactly one test() per demo spec.
 */
import { newUlid } from "../../src/lib/ids";
import { nowSeconds } from "../../src/lib/now";
import { count, eq, inArray } from "drizzle-orm";

import {
  brands,
  gaveUp,
  products,
  reviewQueue,
  runs,
  userProfiles,
} from "../../src/db/schema-core";
import { expect, scene, test } from "../support/demo";
import { withLocalDb } from "../support/local-db";
import { signInAsOperator } from "./operator";

const HOUR = 3600;

test("an operator opens the Desk and reads Today", async ({ page }) => {
  // What Today counts: three more things waiting (one 19 hours old), one of
  // them a photo the screener sent, and a ban this week. Added to whatever
  // the local database already holds, never in place of it.
  const seeded = [newUlid(), newUlid(), newUlid()] as const;
  const banned = newUlid();
  const waitingBefore = await withLocalDb(async ({ core }) => {
    const [row] = await core
      .select({ rows: count() })
      .from(reviewQueue)
      .where(eq(reviewQueue.status, "pending"));
    const now = nowSeconds();
    await core.insert(reviewQueue).values([
      {
        id: seeded[0],
        subjectType: "entry",
        subjectId: newUlid(),
        source: "reports",
        status: "pending",
        createdAt: now - 19 * HOUR,
      },
      {
        id: seeded[1],
        subjectType: "photo",
        subjectId: newUlid(),
        source: "classifier",
        status: "pending",
        createdAt: now - 2 * HOUR,
      },
      {
        id: seeded[2],
        subjectType: "profile",
        subjectId: newUlid(),
        source: "reports",
        status: "pending",
        createdAt: now - 5 * HOUR,
      },
    ]);
    await core
      .insert(userProfiles)
      .values({ userId: banned, bannedAt: now - 24 * HOUR });
    return row?.rows ?? 0;
  });
  const waiting = String(waitingBefore + 3);

  // What Gave up lists (R-119): a product page that refused us, a run
  // whose weather never came, and one more, so the section shows two and
  // offers the rest. Added to whatever the table already holds.
  const brandId = newUlid();
  const productId = newUlid();
  const runId = newUlid();
  const gaveUpIds = [newUlid(), newUlid(), newUlid()] as const;
  const gaveUpBefore = await withLocalDb(async ({ core }) => {
    const [row] = await core.select({ rows: count() }).from(gaveUp);
    const now = nowSeconds();
    await core
      .insert(brands)
      .values({ id: brandId, name: "Janji", normalized: `janji ${brandId}` });
    await core.insert(products).values({
      id: productId,
      brandId,
      name: "AFO Middle Layer",
      normalizedName: "afo middle layer",
      extractionStatus: "failed",
      createdBy: banned,
      createdAt: now - 30 * HOUR,
    });
    await core.insert(runs).values({
      id: runId,
      userId: banned,
      source: "manual",
      startedAt: now - 50 * HOUR,
      durationS: 2400,
      distanceM: 8000,
      lat: 47.6,
      lng: -122.3,
      title: "Morning run",
      weatherStatus: "failed",
    });
    await core.insert(gaveUp).values([
      {
        id: gaveUpIds[0],
        kind: "enrichment",
        subjectId: productId,
        reason: "The shop returned 403. It may be blocking us.",
        rawError: "Page returned 403",
        tries: 3,
        firstFailedAt: now - 6 * HOUR,
        lastFailedAt: now - 2 * HOUR,
      },
      {
        id: gaveUpIds[1],
        kind: "weather",
        subjectId: runId,
        reason:
          "No weather came back for this run in five hours of hourly tries.",
        tries: 5,
        firstFailedAt: now - 45 * HOUR,
        lastFailedAt: now - 3 * HOUR,
      },
      {
        id: gaveUpIds[2],
        kind: "import",
        subjectId: newUlid(),
        reason:
          "It failed every try the queue gives a job, so the queue stopped. Each error is in Sentry.",
        tries: 4,
        firstFailedAt: now - 50 * HOUR,
        lastFailedAt: now - 4 * HOUR,
      },
    ]);
    return row?.rows ?? 0;
  });
  const gaveUpCount = gaveUpBefore + 3;

  await signInAsOperator(page);

  await page.goto("/desk");
  await page
    .locator('html[data-hydrated="true"]')
    .waitFor({ state: "attached" });
  await scene(page, "The Desk: its own dark shell, reached only by address");
  const rail = page.getByRole("navigation", { name: "Desk" });
  await expect(rail.getByText("Desk", { exact: true })).toBeVisible();
  await expect(rail.getByRole("link", { name: "Today" })).toHaveAttribute(
    "aria-current",
    "page",
  );

  await scene(page, "Today: the digest's three numbers, from its own query");
  const stats = page
    .getByRole("list", { name: "Today" })
    .getByRole("listitem")
    .filter({ hasText: "decision" });
  await expect(stats).toContainText(`${waiting}waiting for a decision`);
  await expect(stats).toContainText(/Oldest · \d+h/u);
  await expect(
    page.getByText(/photos? the screener couldn't finish/u),
  ).toBeVisible();
  await expect(page.getByText(/bans? this week/u)).toBeVisible();

  await scene(page, "Review carries the count that needs a person");
  await expect(
    rail.getByRole("link", { name: `Review ${waiting}` }),
  ).toBeVisible();

  await scene(page, "D-87's rail: Today, Review, Access, Duplicates, Runners");
  await expect(
    rail.getByRole("link", { name: `Today ${String(gaveUpCount)}` }),
  ).toBeVisible();
  await expect(rail.getByText("Gave up")).toHaveCount(0);

  await scene(page, "Gave up: two newest jobs, the rest one press away");
  const gave = page.getByRole("region", { name: "Gave up" });
  await expect(gave.getByText(/\[\d+ jobs · oldest \d+[mhd]\]/u)).toBeVisible();
  // Two show, and at least three were seeded, so Show all is there.
  await gave.getByRole("button", { name: /more · Show all/u }).click();

  await scene(page, "Each row: what it was doing, why it stopped, its tries");
  const refused = gave
    .getByRole("listitem")
    .filter({ hasText: "Read the product page for Janji AFO Middle Layer" });
  await expect(refused).toContainText(
    "The shop returned 403. It may be blocking us.",
  );
  await expect(refused).toContainText("3 tries · last");
  // Enrichment's two retries; re-run waits for a stored page.
  await expect(
    refused.getByRole("button", { name: /Re-run extraction/u }),
  ).toHaveAttribute("aria-disabled", "true");
  await refused.getByText("Raw error").click();
  await expect(refused.getByText("Page returned 403")).toBeVisible();

  const weather = gave
    .getByRole("listitem")
    .filter({ hasText: "Fetch weather for" })
    .filter({ hasText: "five hours" });
  await expect(weather).toBeVisible();

  await scene(page, "Retry sends a run's weather back to the hourly cron");
  await weather.getByRole("button", { name: /^Retry/u }).click();
  await expect(weather).toHaveCount(0);
  await expect(
    rail.getByRole("link", { name: `Today ${String(gaveUpCount - 1)}` }),
  ).toBeVisible();

  await scene(page, "Drop removes the row and nothing else");
  await refused.getByRole("button", { name: /^Drop/u }).click();
  await expect(refused).toHaveCount(0);

  await withLocalDb(async ({ core }) => {
    await core.delete(gaveUp).where(inArray(gaveUp.id, [...gaveUpIds]));
    await core.delete(runs).where(eq(runs.id, runId));
    await core.delete(products).where(eq(products.id, productId));
    await core.delete(brands).where(eq(brands.id, brandId));
    await core.delete(reviewQueue).where(inArray(reviewQueue.id, [...seeded]));
    await core
      .delete(userProfiles)
      .where(inArray(userProfiles.userId, [banned]));
  });
});
