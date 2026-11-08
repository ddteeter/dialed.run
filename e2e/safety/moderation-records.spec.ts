/**
 * Covers, beside `moderation.journey.spec.ts`, the Desk's records: the
 * quarantine with its NCMEC report recorded (C12, design 145); a copyright
 * hold's counter-notice, court action and the case's end (C5, D-130,
 * D-146); and D8's flag on the poster of an upheld intimate-image removal
 * with its Keep account (D-161 1, R47·124).
 *
 * Needs `ADMIN_USER_IDS=e2e-desk-operator` in the dev server's
 * `.dev.vars`, as the journey does. Every test seeds its rows with ids it
 * generated and removes exactly those.
 */
import { eq, or } from "drizzle-orm";

import {
  copyrightHolds,
  moderationActions,
  quarantinedContent,
} from "../../src/db/schema-core";
import { newUlid } from "../../src/lib/ids";
import { nowSeconds } from "../../src/lib/now";
import { removalStatements } from "../../src/modules/safety/contracts";
import { OPERATOR_ID, signInAsOperator } from "../desk/operator";
import { expect, test } from "../support/a11y";
import { hydrated } from "../support/demo";
import { withLocalDb } from "../support/local-db";
import {
  handleOf,
  removeRunnerRows,
  seedRunnerRow,
} from "./moderation-support";

test("Quarantine · recording the NCMEC report keeps the record a year from it", async ({
  page,
}) => {
  // A quarantined record not yet reported to NCMEC (C12). Synthetic: no
  // content and no photos, only the record's own columns.
  const quarantineId = newUlid();
  const uploaderId = newUlid();
  const reportNumber = `E2E-${String(Date.now()).slice(-8)}`;
  const now = nowSeconds();
  await withLocalDb(({ core }) =>
    core.insert(quarantinedContent).values({
      id: quarantineId,
      moderationActionId: newUlid(),
      subjectType: "entry",
      subjectId: newUlid(),
      uploaderId,
      entryId: newUlid(),
      entrySnapshot: "{}",
      photosSnapshot: "[]",
      quarantinedAt: now,
      retainUntil: now + 365 * 86_400,
    }),
  );
  try {
    await signInAsOperator(page);
    await page.goto("/desk/review");
    await hydrated(page);
    // C12: recording the CyberTipline report keeps the record a year from
    // the report, and the row says so at once.
    const held = page
      .locator("[data-part='quarantine-record']")
      .filter({ hasText: uploaderId });
    await held.scrollIntoViewIfNeeded();
    await expect(held.getByText("[not reported to NCMEC]")).toBeVisible();
    await held
      .getByRole("textbox", { name: /CyberTipline report number/ })
      .fill(reportNumber);
    await held.getByRole("button", { name: "Record the NCMEC report" }).click();
    await expect(held.getByText("Report recorded.")).toBeVisible();
    await expect(held.locator("[data-part='ncmec']")).toContainText(
      /\[reported to NCMEC .+\]/,
    );
    await expect(held.locator("[data-part='ncmec']")).toContainText(
      reportNumber,
    );

    const [report] = await withLocalDb(({ core }) =>
      core
        .select({
          reportedAt: quarantinedContent.ncmecReportedAt,
          reportId: quarantinedContent.ncmecReportId,
          retainUntil: quarantinedContent.retainUntil,
        })
        .from(quarantinedContent)
        .where(eq(quarantinedContent.id, quarantineId)),
    );
    expect(report?.reportId).toBe(reportNumber);
    expect(report?.reportedAt).toBeGreaterThanOrEqual(now);
    // A year from the report, which is later than the quarantine's own year.
    expect(report?.retainUntil).toBe((report?.reportedAt ?? 0) + 365 * 86_400);
  } finally {
    await withLocalDb(({ core }) =>
      core
        .delete(quarantinedContent)
        .where(eq(quarantinedContent.id, quarantineId)),
    );
  }
});

test("Copyright holds · counter-notice, court action, then the case's end", async ({
  page,
}) => {
  // A copyright takedown's hold (D-130, design 149), hidden today with no
  // counter-notice yet. Synthetic: the audit row and the hold only.
  const holdActionId = newUlid();
  const heldPhotoId = newUlid();
  const holdOwnerId = newUlid();
  const now = nowSeconds();
  await withLocalDb(async ({ core }) => {
    await core.insert(moderationActions).values({
      id: holdActionId,
      actorId: OPERATOR_ID,
      action: "takedown",
      subjectType: "photo",
      subjectId: heldPhotoId,
      subjectOwnerId: holdOwnerId,
      reason: `it uses someone else's work — Acme Photo Co, ref ${String(now)}`,
      createdAt: now,
    });
    await core.insert(copyrightHolds).values({
      id: newUlid(),
      moderationActionId: holdActionId,
      subjectType: "photo",
      subjectId: heldPhotoId,
      ownerId: holdOwnerId,
      entryId: newUlid(),
      status: "hidden",
      hiddenAt: now,
      purgeAt: now + 30 * 86_400,
    });
  });
  try {
    await signInAsOperator(page);
    await page.goto("/desk/review");
    await hydrated(page);
    // D-130: the counter-notice sets the day it comes back, and a court
    // action cancels that and holds it until the case ends (D-146), when
    // the Desk restores or deletes it.
    const copyrightHold = page
      .locator("[data-part='copyright-hold']")
      .filter({ hasText: heldPhotoId });
    await copyrightHold.scrollIntoViewIfNeeded();
    await expect(copyrightHold.locator("[data-part='owner']")).toHaveText(
      `Owner ${holdOwnerId} · strikes 1`,
    );
    await expect(copyrightHold.locator("[data-part='hold-state']")).toHaveText(
      /^\[no counter-notice: deleted .+\]$/u,
    );
    // RECEIVED ON defaults to today (round 39 #73).
    await expect(copyrightHold.getByLabel("Received on")).toHaveValue(
      /^\d{4}-\d{2}-\d{2}$/u,
    );
    await copyrightHold
      .getByRole("button", { name: "Counter-notice received" })
      .click();
    await expect(copyrightHold.locator("[data-part='hold-said']")).toHaveText(
      "Counter-notice recorded.",
    );
    await expect(copyrightHold.locator("[data-part='hold-state']")).toHaveText(
      /^\[counter-notice received: back .+\]$/u,
    );
    await copyrightHold
      .getByRole("button", { name: "Court action filed" })
      .click();
    await expect(copyrightHold.locator("[data-part='hold-said']")).toHaveText(
      "Court action recorded. It stays hidden until the case is over.",
    );
    await expect(copyrightHold.locator("[data-part='hold-state']")).toHaveText(
      /^\[court action .+: held until the case is over\]$/u,
    );
    await expect(
      copyrightHold.getByRole("button", { name: "Case over: delete" }),
    ).toBeVisible();
    // Both ends confirm in place (round 39 #73); Not yet puts the pair back.
    await copyrightHold
      .getByRole("button", { name: "Case over: delete" })
      .click();
    await expect(
      copyrightHold.getByRole("alertdialog", {
        name: "Delete it for good? It can't be put back.",
      }),
    ).toBeVisible();
    await copyrightHold.getByRole("button", { name: "Not yet" }).click();
    await expect(
      copyrightHold.getByRole("button", { name: "Case over: delete" }),
    ).toBeFocused();
    await copyrightHold
      .getByRole("button", { name: "Case over: restore" })
      .click();
    await copyrightHold.getByRole("button", { name: "Put it back" }).click();
    // A settled row leaves the list; the list says what it did.
    await expect(page.locator("[data-part='holds-said']")).toHaveText(
      "Case over. It is back.",
    );
    await expect(copyrightHold).toHaveCount(0);
  } finally {
    await withLocalDb(async ({ core }) => {
      await core
        .delete(copyrightHolds)
        .where(eq(copyrightHolds.subjectId, heldPhotoId));
      await core
        .delete(moderationActions)
        .where(eq(moderationActions.subjectId, heldPhotoId));
    });
  }
});

test("D8 · Flagged: the poster of an upheld intimate removal, and Keep account", async ({
  page,
}) => {
  // D-161 (1): a runner whose photo a person removed as intimate. The
  // audit row exactly as moderateContent writes it; nothing else is
  // seeded, because the flag is read from that row alone.
  const posterId = newUlid();
  const posterHandle = handleOf("poster");
  await seedRunnerRow(posterId, posterHandle);
  await withLocalDb(({ core }) =>
    core.insert(moderationActions).values({
      id: newUlid(),
      actorId: OPERATOR_ID,
      action: "remove",
      subjectType: "photo",
      subjectId: newUlid(),
      subjectOwnerId: posterId,
      reason: removalStatements.intimate,
      createdAt: nowSeconds(),
    }),
  );
  try {
    await signInAsOperator(page);
    await page.goto("/desk/runners?filter=flagged");
    await hydrated(page);
    await page.getByRole("searchbox").fill(`${posterHandle}@example.com`);
    await page.getByRole("searchbox").press("Enter");
    const poster = page.getByRole("button", { name: `@${posterHandle}` });
    await expect(page.getByRole("row").filter({ has: poster })).toContainText(
      "[ACTIVE][Flagged]",
    );
    await poster.click();
    const column = page.getByRole("complementary", {
      name: `@${posterHandle}`,
    });
    await expect(column.getByRole("heading").first()).toHaveText("Flagged");
    await expect(column).toContainText(
      "A takedown of an image they posted was upheld on",
    );
    await expect(column).not.toContainText(/intimate/iu);

    // Keep account: the flag clears, and nothing else happens.
    await column.getByRole("button", { name: "Keep account" }).click();
    await expect(poster).toHaveCount(0);
    const kept = await withLocalDb(async ({ core }) =>
      core
        .select({ action: moderationActions.action })
        .from(moderationActions)
        .where(eq(moderationActions.subjectId, posterId)),
    );
    expect(kept.map((row) => row.action)).toStrictEqual(["keep"]);
  } finally {
    await withLocalDb(({ core }) =>
      core
        .delete(moderationActions)
        .where(
          or(
            eq(moderationActions.subjectId, posterId),
            eq(moderationActions.subjectOwnerId, posterId),
          ),
        ),
    );
    await removeRunnerRows([posterId]);
  }
});
