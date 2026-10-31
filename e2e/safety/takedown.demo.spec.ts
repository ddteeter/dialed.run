/**
 * Covers: `/takedown` (design 136, decision D-117; drawn in round 35
 * #58e) — the footer's "Report an intimate image", the request form and
 * its receipt, signed out, the kit hidden the moment the request lands —
 * and Review's removal requests, where an operator sees the runner's
 * other photos (D-117, R-145 c) and takes the kit down —
 * then D-147 (design 152): the receipt points to StopNCII and Take It
 * Down, the takedown keeps the photo's fingerprint, and a copy uploaded
 * again waits on Review saying what it matched — then design 137's limits: past two open requests, the next waits for a
 * confirm from its receipt, and the operator blocks the requester and
 * declines the rest. One journey, one video.
 *
 * Needs `ADMIN_USER_IDS=e2e-desk-operator` and Cloudflare's always-pass
 * Turnstile keys in the dev server's `.dev.vars`, which CI's e2e job
 * writes. Locally, put the same lines in yours.
 *
 * Exactly one test() per demo spec.
 */
import { readFile } from "node:fs/promises";

import { eq, inArray, like } from "drizzle-orm";
import { getPlatformProxy } from "wrangler";
import { z } from "zod";

import { user } from "../../src/db/schema-auth";
import {
  entryPhotos,
  outbox,
  outfitEntries,
  removedFingerprints,
  reviewQueue,
  runs,
  takedownBlocks,
  takedownRequests,
  userProfiles,
} from "../../src/db/schema-core";
import { newUlid } from "../../src/lib/ids";
import { readOutboxRow } from "../../src/lib/sql/outbox";
import { nowSeconds } from "../../src/lib/now";
import { signInAsOperator } from "../desk/operator";
import { expect, hydrated, scene, test } from "../support/demo";
import { turnstileAnswered } from "../support/invites";
import { withLocalDb } from "../support/local-db";

test("someone with no account asks for an intimate image to come down, and an operator takes it down", async ({
  page,
}, testInfo) => {
  testInfo.setTimeout(150_000);
  const suffix = String(Date.now()).slice(-8);
  const runnerId = newUlid();
  const handle = `poster_${suffix}`;
  const runId = newUlid();
  const entryId = newUlid();
  const secondRunId = newUlid();
  const secondEntryId = newUlid();
  const extraRequestId = newUlid();
  const otherPhotoId = newUlid();
  const otherPhotoKey = `entries/${runnerId}/${secondEntryId}/${otherPhotoId}`;
  const requester = `asker-${suffix}@example.com`;
  const now = nowSeconds();
  // D-147: the first kit's photo, by a fingerprint this run owns, and the
  // copy of it a runner posts again — one bit apart, as a re-encode is.
  const firstPhotoId = newUlid();
  const fingerprint = `${suffix}0f0f0f0f`;
  const copyFingerprint = `${suffix}0f0f0f0e`;
  const copyRunId = newUlid();
  const copyEntryId = newUlid();
  const copyPhotoId = newUlid();
  const copyPhotoKey = `entries/${runnerId}/${copyEntryId}/${copyPhotoId}`;

  // Earlier runs' requests, by this demo's own address prefix: each one
  // that hid something counts toward the hour's valve (design 137), so a
  // few runs in an hour would otherwise shut it on this one.
  await withLocalDb(async ({ core }) =>
    core
      .delete(takedownRequests)
      .where(like(takedownRequests.requesterEmail, "asker-%@example.com")),
  );

  // One runner with one public kit. Scoped to ids generated here.
  await withLocalDb(async ({ core }) => {
    await core.insert(user).values({
      id: runnerId,
      name: handle,
      email: `${handle}@example.com`,
      emailVerified: true,
      createdAt: new Date(now * 1000),
      updatedAt: new Date(now * 1000),
    });
    await core.insert(userProfiles).values({
      userId: runnerId,
      username: handle,
      cityLabel: "Portland, OR",
    });
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
    // The reported photo on the first kit, fingerprinted at upload.
    await core.insert(entryPhotos).values({
      id: firstPhotoId,
      entryId,
      photoKey: `entries/${runnerId}/${entryId}/${firstPhotoId}`,
      position: 0,
      screenStatus: "pass",
      fingerprint,
    });
    // A second kit, for the request past the cap.
    await core.insert(runs).values({
      id: secondRunId,
      userId: runnerId,
      source: "manual",
      startedAt: now - 7200,
      durationS: 1800,
      distanceM: 5000,
      indoor: false,
      title: "Evening loop",
    });
    await core.insert(outfitEntries).values({
      id: secondEntryId,
      runId: secondRunId,
      userId: runnerId,
      verdict: 0,
      audience: "runners",
      createdAt: now - 7200,
    });
    // A photo on the second kit: the copy candidate Review lists beside
    // the first kit's request (D-117).
    await core.insert(entryPhotos).values({
      id: otherPhotoId,
      entryId: secondEntryId,
      photoKey: otherPhotoKey,
      position: 0,
      screenStatus: "pass",
    });
  });
  const media = await getPlatformProxy<Env>();
  try {
    await media.env.MEDIA.put(
      otherPhotoKey,
      await readFile("test/fixtures/sample-photo.bin"),
      { httpMetadata: { contentType: "image/jpeg" } },
    );
  } finally {
    await media.dispose();
  }

  await scene(page, "Signed out: every page's footer says where to ask");
  await page.goto("/auth/login");
  await hydrated(page);
  await page
    .locator("[data-part='legal-footer']")
    .getByRole("link", { name: "Report an intimate image" })
    .click();
  await expect(page).toHaveURL(/\/takedown$/u);
  await hydrated(page);
  await expect(
    page.getByRole("heading", {
      level: 1,
      name: "Ask us to remove an image",
    }),
  ).toBeVisible();

  await scene(page, "The form asks for the Act's four parts");
  await page.getByLabel("Email").fill(requester);
  await page.getByLabel("Full name").fill("Sam Asker");
  await page
    .getByLabel("Link to the image")
    .fill(`https://dialed.run/feed/entry/${entryId}`);
  await page.getByLabel("What it shows · optional").fill("A photo of me");
  await page.getByRole("checkbox").check();
  await turnstileAnswered(page);
  await page.getByRole("button", { name: "Send the request" }).click();

  await scene(
    page,
    "The receipt: a person decides within 48 hours, and where else to go",
  );
  await expect(
    page.getByRole("heading", { name: "We have your request" }),
  ).toBeVisible({ timeout: 15_000 });
  await expect(page.getByText(requester)).toBeVisible();
  // D-147 (round 41 #85): the two services that reach other sites, last
  // on the receipt, each saying it opens a new tab.
  const elsewhere = page.locator("[data-part='elsewhere-help']");
  await expect(
    elsewhere.getByRole("link", {
      name: "StopNCII.org (opens in a new tab)",
      exact: true,
    }),
  ).toHaveAttribute("href", "https://stopncii.org/");
  await expect(
    elsewhere.getByRole("link", {
      name: "Take It Down (opens in a new tab)",
      exact: true,
    }),
  ).toHaveAttribute("href", "https://takeitdown.ncmec.org/");

  // A link of ours hides the kit at once (round 35 #58e), as a W1 report
  // of the reason does: nobody else sees it while an operator decides.
  const [held] = await withLocalDb(async ({ core }) =>
    core
      .select({ status: outfitEntries.moderationStatus })
      .from(outfitEntries)
      .where(eq(outfitEntries.id, entryId)),
  );
  expect(held?.status).toBe("hidden_pending_review");

  // Design 137: the same requester already has a second open request, so
  // a third waits for a confirm before it hides anything.
  await withLocalDb(async ({ core }) =>
    core.insert(takedownRequests).values({
      id: extraRequestId,
      requesterEmail: requester,
      requesterKey: requester,
      signature: "Sam Asker",
      location: "a photo on another site",
      dueAt: now + 172_800,
      createdAt: now,
      idempotencyKey: newUlid(),
    }),
  );
  await scene(page, "A third request from the same person waits for a confirm");
  await page.goto("/takedown");
  await hydrated(page);
  await page.getByLabel("Email").fill(requester.replace("@", "+again@"));
  await page.getByLabel("Full name").fill("Sam Asker");
  await page
    .getByLabel("Link to the image")
    .fill(`https://dialed.run/feed/entry/${secondEntryId}`);
  // Round 37 #59g: who posted it, when the requester knows.
  await page
    .getByLabel("Their dialed.run username · optional")
    .fill(`@${handle}`);
  await page.getByRole("checkbox").check();
  await turnstileAnswered(page);
  await page.getByRole("button", { name: "Send the request" }).click();
  await expect(
    page.getByRole("heading", { name: "We have your request" }),
  ).toBeVisible({ timeout: 15_000 });
  expect(await statusOf(secondEntryId)).toBe("ok");

  await scene(page, "The receipt's link asks before it confirms");
  const token = await confirmTokenFor(secondEntryId);
  await page.goto(`/takedown/confirm?token=${token}`);
  await hydrated(page);
  await page.getByRole("button", { name: "Confirm the request" }).click();
  await expect(page.getByText("Request confirmed")).toBeVisible({
    timeout: 15_000,
  });
  expect(await statusOf(secondEntryId)).toBe("hidden_pending_review");

  await signInAsOperator(page);

  await scene(page, "Review: the request, its clock, and the kit");
  await page.goto("/safety/review");
  await hydrated(page);
  // The row whose link is the first kit: the requester has three now.
  const request = page.locator("[data-part='removal-request']").filter({
    has: page.locator(`a[href="/feed/entry/${entryId}"]`),
  });
  await expect(request.locator("[data-part='due']")).toHaveText("Due in 48h");
  await expect(request).toContainText("[via /takedown]");
  await expect(request).toContainText("[hidden]");
  await expect(request.locator("[data-part='related']")).toHaveText(
    "2 more from this requester",
  );
  await expect(request).toContainText("From Sam Asker · signed · good faith");
  await expect(request).toContainText(requester);
  await expect(
    request.getByRole("link", { name: "Open the kit" }),
  ).toHaveAttribute("href", `/feed/entry/${entryId}`);

  const others = request.locator("[data-part='other-photos']");
  await others.scrollIntoViewIfNeeded();
  await scene(page, "The runner's other photos, to check for copies");
  await expect(others).toContainText("Their other photos · 1");
  // The second kit is hidden by its own confirmed request, so its page
  // would send an operator away: the photo shows with no link (R-154).
  await expect(others.getByRole("link")).toHaveCount(0);
  await expect(
    others.getByRole("img", {
      name: `Photo ${otherPhotoId}, on a kit an operator cannot open`,
    }),
  ).toHaveAttribute("src", `/safety/review-photo/${otherPhotoKey}`);
  await expect(others).toContainText(otherPhotoId);

  await scene(page, "Take it down: the kit goes, and the requester is told");
  await request.getByRole("button", { name: "Take it down" }).click();
  await expect(request).toHaveCount(0, { timeout: 15_000 });

  const [gone] = await withLocalDb(async ({ core }) =>
    core
      .select({ id: outfitEntries.id })
      .from(outfitEntries)
      .where(eq(outfitEntries.id, entryId)),
  );
  expect(gone).toBeUndefined();
  const [decided] = await withLocalDb(async ({ core }) =>
    core
      .select({ status: takedownRequests.status })
      .from(takedownRequests)
      .where(eq(takedownRequests.requesterEmail, requester)),
  );
  expect(decided?.status).toBe("removed");
  // D-147: the photo is gone, and its fingerprint is kept.
  const kept = await withLocalDb(async ({ core }) =>
    core
      .select({ id: removedFingerprints.id })
      .from(removedFingerprints)
      .where(eq(removedFingerprints.fingerprint, fingerprint)),
  );
  expect(kept).toHaveLength(1);

  // The runner posts the same picture again. The upload's check (proved in
  // test/safety/removed-fingerprints.test.ts) leaves it as seeded here:
  // held from everyone but its owner, with a fingerprint row on Review.
  await withLocalDb(async ({ core }) => {
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
  const copyMedia = await getPlatformProxy<Env>();
  try {
    await copyMedia.env.MEDIA.put(
      copyPhotoKey,
      await readFile("test/fixtures/sample-photo.bin"),
      { httpMetadata: { contentType: "image/jpeg" } },
    );
  } finally {
    await copyMedia.dispose();
  }

  await scene(
    page,
    "A copy posted again waits on Review, saying what it matched",
  );
  await page.reload();
  await hydrated(page);
  // Its Review row, by the row's own label: the photo also shows under
  // the open request's "Their other photos", and in an earlier run's
  // "Matching photos".
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
  // Scoped to this run's ids, so a rerun starts from the same queue.
  await withLocalDb(async ({ core }) => {
    await core
      .delete(reviewQueue)
      .where(eq(reviewQueue.subjectId, copyPhotoId));
    await core.delete(entryPhotos).where(eq(entryPhotos.id, copyPhotoId));
    await core
      .delete(removedFingerprints)
      .where(eq(removedFingerprints.fingerprint, fingerprint));
  });

  await scene(
    page,
    "Block and decline all: the rest go, and the kit comes back",
  );
  const rest = page
    .locator("[data-part='removal-request']")
    .filter({ hasText: "Evening" })
    .or(
      page
        .locator("[data-part='removal-request']")
        .filter({ hasText: requester.replace("@", "+again@") }),
    )
    .first();
  await rest.getByRole("button", { name: "Block and decline all" }).click();
  await rest.getByRole("button", { name: "Block and decline all" }).click();
  await expect(
    page
      .locator("[data-part='removal-request']")
      .filter({ hasText: `asker-${suffix}` }),
  ).toHaveCount(0, { timeout: 15_000 });
  expect(await statusOf(secondEntryId)).toBe("ok");
  await withLocalDb(async ({ core }) => {
    await core.delete(takedownBlocks).where(eq(takedownBlocks.key, requester));
  });
});

async function statusOf(id: string) {
  const [row] = await withLocalDb(async ({ core }) =>
    core
      .select({ status: outfitEntries.moderationStatus })
      .from(outfitEntries)
      .where(eq(outfitEntries.id, id)),
  );
  return row?.status;
}

const receiptTemplate = z
  .object({ confirmToken: z.string().optional() })
  .loose();
const receiptPayload = z.object({
  email: z.object({ template: receiptTemplate }),
});

/**
The confirm token the receipt of the request naming `entryId` carries.
*/
async function confirmTokenFor(entryId: string): Promise<string> {
  const rows = await withLocalDb(async ({ core }) =>
    core
      .select({ id: takedownRequests.id })
      .from(takedownRequests)
      .where(eq(takedownRequests.subjectId, entryId)),
  );
  const ids = rows.map((row) => `removal_request_received:${row.id}`);
  const owed = await withLocalDb(async ({ core }) =>
    core
      .select({ payload: outbox.payload, dedupeKey: outbox.dedupeKey })
      .from(outbox)
      .where(inArray(outbox.dedupeKey, ids)),
  );
  for (const row of owed) {
    const read = readOutboxRow("email", row.payload);
    const parsed = receiptPayload.safeParse(
      read.ok ? read.message.payload : undefined,
    );
    const token = parsed.success
      ? parsed.data.email.template.confirmToken
      : undefined;
    if (token !== undefined) return token;
  }
  throw new Error("no confirm token owed");
}
