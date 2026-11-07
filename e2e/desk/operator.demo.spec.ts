/**
 * Covers: D0 (the Desk's shell) and Today, with D6 · Gave up as Today's
 * section (D-87; R-119), then a hold breaker at its ceiling: Today's HOLDS
 * PAUSED line and Review's release of the burst (design 164; design
 * deltas 93 and 95), on the Desk's own dark ground with the rail (R-173),
 * and the outbox running behind (design 168) — one journey, one video.
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
  cronCheckpoints,
  gaveUp,
  outbox,
  products,
  reviewQueue,
  runs,
  userProfiles,
} from "../../src/db/schema-core";
import { expect, scene, test } from "../support/demo";
import { withLocalDb } from "../support/local-db";
import { signInAsOperator } from "./operator";

const HOUR = 3600;

test("an operator opens the Desk and reads Today", async ({
  page,
}, testInfo) => {
  // Paced for recording (DEMO_SLOWMO), the breaker scenes (design 164)
  // take the journey past the default 30 seconds.
  testInfo.setTimeout(120_000);
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

  // What the morning's drain could not reach (design 168): photo deletes
  // due 38 hours ago, behind a digest that ran an hour ago. The heartbeat
  // this replaces is put back at the end.
  const behindIds = [newUlid(), newUlid(), newUlid()] as const;
  const heartbeatBefore = await withLocalDb(async ({ core }) => {
    const [row] = await core
      .select({ at: cronCheckpoints.lastRunAt })
      .from(cronCheckpoints)
      .where(eq(cronCheckpoints.cronName, "daily-digest"));
    const now = nowSeconds();
    await core
      .insert(cronCheckpoints)
      .values({ cronName: "daily-digest", lastRunAt: now - HOUR })
      .onConflictDoUpdate({
        target: cronCheckpoints.cronName,
        set: { lastRunAt: now - HOUR },
      });
    await core.insert(outbox).values(
      behindIds.map((id) => ({
        id,
        kind: "photo_delete",
        dedupeKey: `e2e-behind:${id}`,
        payload: JSON.stringify({ userId: banned, itemId: id }),
        nextAttemptAt: now - 38 * HOUR,
        createdAt: now - 40 * HOUR,
      })),
    );
    return row?.at;
  });

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

  await scene(page, "Running behind: what the morning's drain couldn't reach");
  const behind = page.locator("[data-part='running-behind']");
  await expect(behind).toContainText("Running behind");
  await expect(behind).toContainText(
    "queued jobs were still due after this morning's run.",
  );
  await expect(behind).toContainText(/waited \d+h/u);

  await scene(page, "Review carries the count that needs a person");
  await expect(
    rail.getByRole("link", { name: `Review ${waiting} waiting` }),
  ).toBeVisible();

  await scene(page, "D-87's rail: Today, Review, Access, Duplicates, Runners");
  await expect(
    rail.getByRole("link", { name: `Today ${String(gaveUpCount)} gave up` }),
  ).toBeVisible();
  // No "Gave up" entry of its own: Today's count is it. The count's
  // " gave up" is sr-only words, lower case, so only an entry matches.
  await expect(rail.getByText("Gave up", { exact: true })).toHaveCount(0);

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

  // Design 164: a bug holds five uploads as copies of a removed image in
  // one hour, the fingerprint breaker's ceiling. Rows only, opened now.
  const burst = Array.from({ length: 5 }, () => newUlid());
  await withLocalDb(async ({ core }) => {
    const now = nowSeconds();
    await core.insert(reviewQueue).values(
      burst.map((id) => ({
        id,
        subjectType: "photo" as const,
        subjectId: newUlid(),
        source: "fingerprint" as const,
        status: "pending" as const,
        createdAt: now,
        openedAt: now,
      })),
    );
  });

  await page.reload();
  await page
    .locator('html[data-hydrated="true"]')
    .waitFor({ state: "attached" });
  await scene(page, "A breaker at its ceiling: Today says what stopped");
  const paused = page
    .locator("[data-part='breaker-over']")
    .filter({ hasText: "matched removed images" });
  await expect(paused).toContainText("Holds paused");
  await expect(paused).toContainText(
    "uploads matched removed images in the last hour, the most held in one hour. New matches are screened like any photo until the hour clears.",
  );

  await scene(page, "Review is a Desk page: the rail opens it, dark");
  await page
    .getByRole("navigation", { name: "Desk" })
    .getByRole("link", { name: /^Review/u })
    .click();
  await expect(page).toHaveURL(/\/desk\/review$/u);
  await page
    .locator('html[data-hydrated="true"]')
    .waitFor({ state: "attached" });
  // R-173: inside DeskShell, so on the night ground (dark in both themes,
  // design 185) with the rail, Review lit.
  await expect(
    page.getByRole("navigation", { name: "Desk" }).getByRole("link", {
      name: /^Review/u,
    }),
  ).toHaveAttribute("aria-current", "page");
  const ink = page.locator("[data-ground='night']");
  await expect(
    ink.getByRole("heading", { name: "Review", exact: true, level: 1 }),
  ).toBeVisible();
  // Round 44 #106: how the page stands, beside the heading, even at zero.
  await expect(
    ink.getByText(/^\[\d+ waiting · \d+ decided today\]$/iu),
  ).toBeVisible();
  await scene(page, "Review: the burst, waiting from the last day");
  const held = page.locator("[data-part='release-holds']");
  await expect(held).toContainText("Held in the last day");
  await expect(held).toContainText(/Fingerprint matches · \d+ waiting/u);

  await scene(page, "Release them: each one an Approve, behind a confirm");
  // Every waiting fingerprint hold from the last day: in CI, the five.
  // The fingerprint row only: another source's burst from the same day
  // (a report raised by an earlier demo) has its own Approve all.
  await held
    .getByRole("listitem")
    .filter({ hasText: "Fingerprint matches" })
    .getByRole("button", { name: /^Approve all \d+$/u })
    .click();
  await expect(
    page.getByRole("heading", { name: /^Approve \d+ fingerprint holds\?$/u }),
  ).toBeVisible();
  await expect(page.getByRole("button", { name: "Keep it" })).toBeFocused();
  await page.getByRole("button", { name: "Approve all", exact: true }).click();
  await expect(
    held.getByText(/Fingerprint matches · \d+ waiting/u),
  ).toHaveCount(0);
  const released = await withLocalDb(async ({ core }) =>
    core
      .select({ status: reviewQueue.status })
      .from(reviewQueue)
      .where(inArray(reviewQueue.id, burst)),
  );
  expect(released.map((row) => row.status)).toStrictEqual(
    burst.map(() => "approved"),
  );

  await scene(page, "A fresh load counts them as decided today");
  // Round 44 #106: the header says how the page stands, and the release
  // was today's decisions. A full load, so it is read from the server.
  await page.goto("/desk/review");
  await page
    .locator('html[data-hydrated="true"]')
    .waitFor({ state: "attached" });
  const standing = ink.getByText(/^\[\d+ waiting · \d+ decided today\]$/iu);
  await expect(standing).toBeVisible();
  const decided = Number(
    ((await standing.textContent()) ?? "")
      .split("·", 2)[1]
      ?.trim()
      .split(" ", 1)[0],
  );
  expect(decided).toBeGreaterThanOrEqual(burst.length);
  await expect(
    held.getByText(/Fingerprint matches · \d+ waiting/u),
  ).toHaveCount(0);

  await withLocalDb(async ({ core }) => {
    await core.delete(reviewQueue).where(inArray(reviewQueue.id, burst));
    await core.delete(gaveUp).where(inArray(gaveUp.id, [...gaveUpIds]));
    await core.delete(runs).where(eq(runs.id, runId));
    await core.delete(products).where(eq(products.id, productId));
    await core.delete(brands).where(eq(brands.id, brandId));
    await core.delete(reviewQueue).where(inArray(reviewQueue.id, [...seeded]));
    await core
      .delete(userProfiles)
      .where(inArray(userProfiles.userId, [banned]));
    await core.delete(outbox).where(inArray(outbox.id, [...behindIds]));
    await (heartbeatBefore === undefined
      ? core
          .delete(cronCheckpoints)
          .where(eq(cronCheckpoints.cronName, "daily-digest"))
      : core
          .update(cronCheckpoints)
          .set({ lastRunAt: heartbeatBefore })
          .where(eq(cronCheckpoints.cronName, "daily-digest")));
  });
});
