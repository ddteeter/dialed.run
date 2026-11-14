/**
 * Covers: §AG's WRONG? sheet and its receipt (D-163, R48·129), the Desk's
 * Corrections queue with its rail count and Apply (R48·130), the filer's
 * bell row and where it goes (R48·129f), a follow row on the bell
 * (R48·131), and Review's WHO REPORTED fold, whose opening is recorded
 * (D-164, R-66) — one journey, one video.
 *
 * Needs `ADMIN_USER_IDS=e2e-desk-operator` in the dev server's
 * `.dev.vars`, as `operator.journey.spec.ts` does.
 *
 * Exactly one test() per journey spec.
 */
import { and, eq, inArray } from "drizzle-orm";

import {
  brands,
  notifications,
  productCorrections,
  products,
  reports,
  reviewAudit,
  reviewQueue,
  userProfiles,
  wardrobeItems,
} from "../../src/db/schema-core";
import { newUlid } from "../../src/lib/ids";
import { nowSeconds } from "../../src/lib/now";
import { expect, hydrated, scene, test } from "../support/demo";
import { signInAsKnownUser } from "../support/known-user";
import { withLocalDb } from "../support/local-db";
import { OPERATOR_ID, signInAsOperator } from "./operator";
import { queueRowFor } from "../safety/moderation-support";

const RUNNER_ID = "e2e-corrections-runner";
const RUNNER_HANDLE = "wrong_spotter";

test("a runner corrects a product, the Desk applies it, and the bell says so", async ({
  page,
}, testInfo) => {
  testInfo.setTimeout(120_000);
  const suffix = String(Date.now()).slice(-8);
  const brandId = newUlid();
  const productId = newUlid();
  const garmentId = newUlid();
  const productName = `AFO Middle Layer ${suffix}`;
  const followerId = newUlid();
  const followerHandle = `ada_${suffix}`;
  const reporterIds = [newUlid(), newUlid()];
  const firstReporter = `spotter_${suffix}`;
  const reporterHandles = [firstReporter, `second_${suffix}`];
  const queueId = newUlid();
  const reportedEntryId = newUlid();
  const now = nowSeconds();

  await signInAsKnownUser(page, RUNNER_ID, RUNNER_HANDLE);
  await withLocalDb(async ({ core }) => {
    await core.insert(brands).values({
      id: brandId,
      name: "Janji",
      normalized: `janji ${brandId}`,
    });
    await core.insert(products).values({
      id: productId,
      brandId,
      name: productName,
      normalizedName: productName.toLowerCase(),
      weight: "mid",
      fabricComposition: "100% polyester",
      createdBy: RUNNER_ID,
      createdAt: now,
    });
    await core.insert(wardrobeItems).values({
      id: garmentId,
      userId: RUNNER_ID,
      category: "top",
      brand: "Janji",
      name: productName,
      productId,
      origin: "manual",
      createdAt: now,
    });
    // A follow that rang the runner's bell (R48·131); the ring itself is
    // the follow module's, and its tests cover it.
    await core
      .insert(userProfiles)
      .values({ userId: followerId, username: followerHandle });
    await core.insert(notifications).values({
      id: newUlid(),
      userId: RUNNER_ID,
      kind: "followed",
      subjectId: newUlid(),
      linkId: followerId,
      body: `@${followerHandle} followed you.`,
      read: false,
      createdAt: now - 60,
    });
    // A reported entry waiting in Review, for the WHO REPORTED fold.
    await core.insert(userProfiles).values(
      reporterIds.map((userId, index) => ({
        userId,
        username: reporterHandles[index],
      })),
    );
    await core.insert(reports).values(
      reporterIds.map((reporterId) => ({
        id: newUlid(),
        reporterId,
        subjectType: "entry" as const,
        subjectId: reportedEntryId,
        reason: "spam" as const,
        createdAt: now - 3600,
      })),
    );
    await core.insert(reviewQueue).values({
      id: queueId,
      subjectType: "entry",
      subjectId: reportedEntryId,
      source: "reports",
      status: "pending",
      createdAt: now - 3600,
      openedAt: now - 3600,
    });
  });

  // Cleanup runs however the journey ends: a row left waiting changes
  // every later Desk spec's rail and Review transcripts.
  try {
    await page.goto(`/closet/${garmentId}`);
    await hydrated(page);
    await scene(
      page,
      "§AG: what it's made of, and WRONG? at the end of the line",
    );
    await page.getByRole("button", { name: "Wrong?" }).click();

    const sheet = page.getByRole("dialog", { name: "What's wrong with it?" });
    await expect(sheet.getByText(`Janji · ${productName}`)).toBeVisible();
    await scene(page, "Pick the field, then a value of its type");
    await sheet.getByRole("radio", { name: "Weight" }).check();
    const value = sheet.getByRole("combobox", {
      name: "It says Mid. It should say",
    });
    await value.selectOption("light");
    await sheet
      .getByRole("textbox", { name: /How do you know/u })
      .fill("It's on the maker's page.");
    await sheet.getByRole("button", { name: "Send correction" }).click();

    await scene(page, "The receipt swaps in place");
    await expect(
      page.getByRole("heading", { name: "Thanks. We'll check it." }),
    ).toBeFocused();
    await page.getByRole("button", { name: "Done" }).click();

    await signInAsOperator(page);
    await page.goto("/desk");
    await hydrated(page);
    await scene(page, "Corrections: under Review, counting rows");
    const rail = page.getByRole("navigation", { name: "Desk" });
    await expect(
      rail.getByRole("link", { name: /^Corrections \d+ waiting$/u }),
    ).toBeVisible();
    await rail.getByRole("link", { name: /^Corrections/u }).click();
    await expect(page).toHaveURL(/\/desk\/corrections$/u);
    await hydrated(page);

    const row = page.getByRole("article", {
      name: `Janji · ${productName}`,
    });
    await scene(page, "One row: the field, its runners, now and suggested");
    await expect(row.getByText(/^Weight · 1 runner · oldest /u)).toBeVisible();
    // NOW, then SUGGESTED.
    await expect(row.getByRole("definition").nth(1)).toHaveText("Light");
    await expect(row.getByRole("listitem")).toContainText(`@${RUNNER_HANDLE}`);
    await row.getByRole("button", { name: "Apply" }).click();
    await expect(row).toHaveCount(0);

    await page.goto("/desk/review");
    await hydrated(page);
    await scene(page, "Review: who reported, folded, and opening it is logged");
    const fold = queueRowFor(page, reportedEntryId).getByRole("button", {
      name: /Who reported/u,
    });
    await fold.click();
    await expect(fold).toHaveAttribute("aria-expanded", "true");
    await expect(
      page.getByText(`@${firstReporter} · It's an ad, or it's spam`, {
        exact: false,
      }),
    ).toBeVisible();

    await signInAsKnownUser(page, RUNNER_ID, RUNNER_HANDLE);
    await page.goto("/notifications");
    await hydrated(page);
    await scene(page, "The bell: the outcome, and a follow");
    await expect(
      page.getByRole("link", { name: `@${followerHandle} followed you.` }),
    ).toHaveAttribute("href", `/feed/u/${followerHandle}`);
    const fixed = page.getByRole("link", {
      name: `We fixed the weight on ${productName}. Thanks.`,
    });
    await expect(fixed).toHaveAttribute("href", `/closet/${garmentId}`);
    await fixed.click();
    await expect(page).toHaveURL(new RegExp(`/closet/${garmentId}$`, "u"));

    await withLocalDb(async ({ core }) => {
      const audits = await core
        .select()
        .from(reviewAudit)
        .where(
          and(
            eq(reviewAudit.reviewId, queueId),
            eq(reviewAudit.actorId, OPERATOR_ID),
          ),
        );
      expect(audits).toHaveLength(1);
      const [applied] = await core
        .select({ weight: products.weight })
        .from(products)
        .where(eq(products.id, productId));
      expect(applied?.weight).toBe("light");
    });
  } finally {
    await withLocalDb(async ({ core }) => {
      await core.delete(reviewAudit).where(eq(reviewAudit.reviewId, queueId));
      await core.delete(reviewQueue).where(eq(reviewQueue.id, queueId));
      await core.delete(reports).where(eq(reports.subjectId, reportedEntryId));
      await core
        .delete(notifications)
        .where(eq(notifications.userId, RUNNER_ID));
      await core
        .delete(productCorrections)
        .where(eq(productCorrections.productId, productId));
      await core.delete(wardrobeItems).where(eq(wardrobeItems.id, garmentId));
      await core.delete(products).where(eq(products.id, productId));
      await core.delete(brands).where(eq(brands.id, brandId));
      await core
        .delete(userProfiles)
        .where(inArray(userProfiles.userId, [followerId, ...reporterIds]));
    });
  }
});
