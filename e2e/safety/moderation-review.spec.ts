/**
 * Covers, beside `moderation.journey.spec.ts`, Review's rows off the
 * journey's path: round 28 #8's row where suspected CSAM asks again; a
 * garment photo still pending a day on whose file is missing, cleared with
 * no reason, and its owner asked to add it again (D-157, design 167; round
 * 45 #100); and a flagged handle's row with its Keep (round 35 #45).
 *
 * Needs `ADMIN_USER_IDS=e2e-desk-operator` in the dev server's
 * `.dev.vars`, as the journey does. Every test seeds its rows with ids it
 * generated and removes exactly those.
 */
import { eq, inArray } from "drizzle-orm";
import { ulid } from "ulidx";

import {
  moderationActions,
  notifications,
  outfitEntries,
  reviewQueue,
  runs,
  wardrobeItems,
} from "../../src/db/schema-core";
import { newUlid } from "../../src/lib/ids";
import { nowSeconds } from "../../src/lib/now";
import { userIdOf } from "../conformance/logging-fixtures";
import { signInAsOperator } from "../desk/operator";
import { expect, test } from "../support/a11y";
import { hydrated } from "../support/demo";
import { withLocalDb } from "../support/local-db";
import {
  handleOf,
  openRow,
  removeRunnerRows,
  seedRunnerRow,
  signInAsAccount,
  queueRowFor,
} from "./moderation-support";

async function removeQueueRows(subjectIds: readonly string[]): Promise<void> {
  await withLocalDb(({ core }) =>
    core
      .delete(reviewQueue)
      .where(inArray(reviewQueue.subjectId, [...subjectIds])),
  );
}

test("Review · suspected CSAM asks again, in the row, Cancel focused", async ({
  page,
}) => {
  const runnerId = newUlid();
  const handle = handleOf("rude");
  const runId = newUlid();
  const entryId = newUlid();
  const now = nowSeconds();
  await seedRunnerRow(runnerId, handle);
  await withLocalDb(async ({ core }) => {
    await core.insert(runs).values({
      id: runId,
      userId: runnerId,
      source: "manual",
      startedAt: now - 3600,
      durationS: 1800,
      distanceM: 5000,
      indoor: false,
      title: "Morning loop",
    });
    await core.insert(outfitEntries).values({
      id: entryId,
      runId,
      userId: runnerId,
      verdict: 0,
      audience: "runners",
      createdAt: now - 3600,
    });
    await core.insert(reviewQueue).values({
      id: newUlid(),
      subjectType: "entry",
      subjectId: entryId,
      source: "reports",
      status: "pending",
      createdAt: now - 600,
    });
  });
  try {
    await signInAsOperator(page);
    await page.goto("/desk/review");
    await hydrated(page);
    const row = queueRowFor(page, entryId);
    await openRow(row);
    await row
      .getByRole("combobox", { name: /Why it comes down/ })
      .selectOption("it's sexual or explicit");
    await row.getByRole("button", { name: "Remove as suspected CSAM" }).click();
    await expect(
      row.getByText(
        "Remove this entry everywhere and keep the evidence for the report?",
      ),
    ).toBeVisible();
    // Round 29 #3: the quiet line, so nobody assumes the account closed.
    await expect(
      row.getByText(
        `@${handle}'s account stays open. Closing it is a separate action on their Runners page.`,
      ),
    ).toBeVisible();
    await expect(row.getByRole("button", { name: "Cancel" })).toBeFocused();
    await row.getByRole("button", { name: "Cancel" }).click();
    await expect(
      row.getByRole("button", { name: "Remove and report" }),
    ).toHaveCount(0);
    // Cancel puts focus back on the press that asked.
    await expect(
      row.getByRole("button", { name: "Remove as suspected CSAM" }),
    ).toBeFocused();
  } finally {
    await removeQueueRows([entryId]);
    await withLocalDb(async ({ core }) => {
      await core.delete(outfitEntries).where(eq(outfitEntries.id, entryId));
      await core.delete(runs).where(eq(runs.id, runId));
    });
    await removeRunnerRows([runnerId]);
  }
});

test("Review · a photo unscreened a day on, its file missing: Clear photo, and its owner is told", async ({
  page,
}) => {
  // A garment photo of the safety account's, still pending a day after
  // upload, whose file is not in storage (D-157, design 167): what the
  // screening sweep sends.
  const ownerId = await userIdOf("safety");
  const stuckGarmentId = newUlid();
  const now = nowSeconds();
  await withLocalDb(async ({ core }) => {
    await core.insert(wardrobeItems).values({
      id: stuckGarmentId,
      userId: ownerId,
      category: "top",
      name: "Lost tee",
      origin: "manual",
      // The version is the upload's clock (design 167): two days old.
      photoKey: `items/${ownerId}/${stuckGarmentId}/${ulid((now - 2 * 86_400) * 1000)}`,
      visibility: "pending",
      createdAt: now - 2 * 86_400,
    });
    await core.insert(reviewQueue).values({
      id: newUlid(),
      subjectType: "garment",
      subjectId: stuckGarmentId,
      source: "missing_file",
      status: "pending",
      createdAt: now - 1000,
    });
  });
  try {
    await signInAsOperator(page);
    await page.goto("/desk/review");
    await hydrated(page);
    // Review says which failure it is; a missing file draws no photo.
    const stuckRow = queueRowFor(page, stuckGarmentId);
    await expect(stuckRow.getByText("[file missing]")).toBeVisible();
    await expect(
      stuckRow.getByText(
        "Uploaded over a day ago, and its file is not in storage, so it cannot be screened or shown. Nobody but its owner sees it while it waits.",
      ),
    ).toBeVisible();
    await expect(stuckRow.getByRole("img")).toHaveCount(0);
    // Round 45 #100: with no file there is nothing to judge and no evidence
    // to keep, so Clear photo is the row's only decision, and it asks no
    // reason; it takes the photo off, citing no rule.
    await openRow(stuckRow);
    for (const gone of ["Approve", "Remove", "Remove as suspected CSAM"]) {
      await expect(
        stuckRow.getByRole("button", { name: gone, exact: true }),
      ).toHaveCount(0);
    }
    await expect(stuckRow.getByLabel(/Why it comes down/u)).toHaveCount(0);
    await stuckRow.getByRole("button", { name: "Clear photo" }).click();
    await expect(queueRowFor(page, stuckGarmentId)).toHaveCount(0);

    // D-157: the cleared photo's owner is asked to add it again.
    await signInAsAccount(page, "safety");
    await page.goto("/notifications");
    await hydrated(page);
    const rows = page.locator("[data-part='notification-row']");
    await expect(
      rows
        .filter({ hasText: "We couldn't find the file for the photo" })
        .locator("p"),
    ).toHaveText(
      "We couldn't find the file for the photo of one of your garments, so we took it off. Add it again from your Closet if you'd like it there.",
    );
  } finally {
    await removeQueueRows([stuckGarmentId]);
    await withLocalDb(async ({ core }) => {
      await core
        .delete(notifications)
        .where(eq(notifications.subjectId, stuckGarmentId));
      await core
        .delete(wardrobeItems)
        .where(eq(wardrobeItems.id, stuckGarmentId));
    });
  }
});

test("Review · a handle the hourly re-check flagged, and its Keep", async ({
  page,
}) => {
  // A handle the hourly re-check flagged after it was claimed (D-97).
  const flaggedId = newUlid();
  const flaggedHandle = handleOf("edgy");
  const now = nowSeconds();
  await seedRunnerRow(flaggedId, flaggedHandle, {
    usernameScreen: "flagged",
    usernameScreenedAt: now - 300,
  });
  await withLocalDb(({ core }) =>
    core.insert(reviewQueue).values({
      id: newUlid(),
      subjectType: "profile",
      subjectId: flaggedId,
      source: "classifier",
      status: "pending",
      createdAt: now - 300,
    }),
  );
  try {
    await signInAsOperator(page);
    await page.goto("/desk/review");
    await hydrated(page);
    // Round 35 #45: a flagged handle's row says why it is there, and
    // offers Keep and Rename rather than Approve and Remove.
    const handleRow = page
      .getByRole("listitem")
      .filter({ hasText: flaggedHandle });
    await expect(handleRow.locator("[data-part='row-head']")).toHaveText(
      `handle · re-check · ${flaggedHandle} [classifier]`,
    );
    await openRow(handleRow);
    await expect(
      handleRow.getByText(
        "The hourly re-check flagged a handle this runner already has. Nothing is hidden while it waits.",
      ),
    ).toBeVisible();
    await expect(handleRow.getByText("[classifier]")).toBeVisible();
    await expect(
      handleRow.getByRole("button", { name: "Approve" }),
    ).toHaveCount(0);
    await handleRow.getByRole("button", { name: "Keep" }).click();
    await expect(
      page.getByRole("listitem").filter({ hasText: flaggedHandle }),
    ).toHaveCount(0);
  } finally {
    await removeQueueRows([flaggedId]);
    await withLocalDb(({ core }) =>
      core
        .delete(moderationActions)
        .where(eq(moderationActions.subjectId, flaggedId)),
    );
    await removeRunnerRows([flaggedId]);
  }
});
