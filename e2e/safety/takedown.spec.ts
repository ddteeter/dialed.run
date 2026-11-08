/**
 * Covers, beside `takedown.journey.spec.ts`: D-147 (design 152) — a copy
 * of a photo removed as intimate, posted again, waits on Review saying
 * what it matched, with the removed original as a frame that is never
 * shown (round 41 #84).
 *
 * Needs `ADMIN_USER_IDS=e2e-desk-operator` in the dev server's
 * `.dev.vars`, as the journey does. Seeds its rows with ids it generated
 * and removes exactly those.
 */
import { eq } from "drizzle-orm";

import {
  entryPhotos,
  moderationActions,
  outfitEntries,
  removedFingerprints,
  reviewQueue,
  runs,
} from "../../src/db/schema-core";
import { newUlid } from "../../src/lib/ids";
import { nowSeconds } from "../../src/lib/now";
import { removalStatements } from "../../src/modules/safety/contracts";
import { OPERATOR_ID, signInAsOperator } from "../desk/operator";
import { expect, test } from "../support/a11y";
import { hydrated } from "../support/demo";
import { withLocalDb } from "../support/local-db";
import { putSamplePhotos } from "../support/media";
import {
  handleOf,
  removeRunnerRows,
  seedRunnerRow,
} from "./moderation-support";

test("a copy posted again waits on Review, saying what it matched", async ({
  page,
}) => {
  const runnerId = newUlid();
  const handle = handleOf("poster");
  const now = nowSeconds();
  // The photo a takedown removed, by a fingerprint this test owns, and the
  // copy of it the runner posts again — one bit apart, as a re-encode is.
  const suffix = String(Date.now()).slice(-8);
  const fingerprint = `${suffix}0f0f0f0f`;
  const copyFingerprint = `${suffix}0f0f0f0e`;
  const firstPhotoId = newUlid();
  const removalId = newUlid();
  const keptId = newUlid();
  const copyRunId = newUlid();
  const copyEntryId = newUlid();
  const copyPhotoId = newUlid();
  const copyPhotoKey = `entries/${runnerId}/${copyEntryId}/${copyPhotoId}`;

  await seedRunnerRow(runnerId, handle);
  await withLocalDb(async ({ core }) => {
    // What the takedown left (D-147): its audit row, and the fingerprint
    // it kept, naming the photo that is gone.
    await core.insert(moderationActions).values({
      id: removalId,
      actorId: OPERATOR_ID,
      action: "takedown",
      subjectType: "entry",
      subjectId: newUlid(),
      subjectOwnerId: runnerId,
      reason: removalStatements.intimate,
      createdAt: now - 600,
    });
    await core.insert(removedFingerprints).values({
      id: keptId,
      fingerprint,
      photoId: firstPhotoId,
      moderationActionId: removalId,
      createdAt: now - 600,
    });
    // The runner posts the same picture again. The upload's check (proved
    // in test/safety/removed-fingerprints.test.ts) leaves it as seeded
    // here: held from everyone but its owner, with a fingerprint row on
    // Review.
    await core.insert(runs).values({
      id: copyRunId,
      userId: runnerId,
      source: "manual",
      startedAt: now - 600,
      durationS: 1800,
      distanceM: 5000,
      indoor: false,
      title: "Lunch loop",
    });
    await core.insert(outfitEntries).values({
      id: copyEntryId,
      runId: copyRunId,
      userId: runnerId,
      verdict: 0,
      audience: "runners",
      createdAt: now - 600,
    });
    await core.insert(entryPhotos).values({
      id: copyPhotoId,
      entryId: copyEntryId,
      photoKey: copyPhotoKey,
      position: 0,
      screenStatus: "hidden_pending_review",
      fingerprint: copyFingerprint,
    });
    await core.insert(reviewQueue).values({
      id: newUlid(),
      subjectType: "photo",
      subjectId: copyPhotoId,
      source: "fingerprint",
      status: "pending",
      createdAt: now,
    });
  });
  await putSamplePhotos([copyPhotoKey]);

  try {
    await signInAsOperator(page);
    await page.goto("/desk/review");
    await hydrated(page);
    // Its Review row, by the row's own label: the photo may also show in
    // an earlier run's "Matching photos".
    const copy = page
      .getByRole("listitem")
      .filter({ has: page.locator("[data-part='removed-match']") })
      .filter({ hasText: `photo · ${copyPhotoId}` });
    await copy.scrollIntoViewIfNeeded();
    await expect(copy.locator("[data-part='removed-match']")).toContainText(
      "A close match to an image removed as intimate on",
    );
    await expect(copy.locator("[data-part='removed-match']")).toContainText(
      "1 bit apart.",
    );
    await expect(copy).toContainText("[held on upload]");
    // Round 41 #84: the removed original stands in as a frame, never shown.
    const removedTile = copy.locator("[data-part='removed-tile']");
    await expect(removedTile).toContainText(firstPhotoId);
    await expect(removedTile).toContainText("1 bit · removed");
    await expect(removedTile).toContainText(`@${handle}`);
    await expect(removedTile.locator("img")).toHaveCount(0);
  } finally {
    await withLocalDb(async ({ core }) => {
      await core
        .delete(reviewQueue)
        .where(eq(reviewQueue.subjectId, copyPhotoId));
      await core.delete(entryPhotos).where(eq(entryPhotos.id, copyPhotoId));
      await core.delete(outfitEntries).where(eq(outfitEntries.id, copyEntryId));
      await core.delete(runs).where(eq(runs.id, copyRunId));
      await core
        .delete(removedFingerprints)
        .where(eq(removedFingerprints.id, keptId));
      await core
        .delete(moderationActions)
        .where(eq(moderationActions.id, removalId));
    });
    await removeRunnerRows([runnerId]);
  }
});
