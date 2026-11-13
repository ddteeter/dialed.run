/**
 * Covers: `/takedown` (design 136, decision D-117; drawn in round 35
 * #58e) — the footer's "Report an intimate image", the request form and
 * its receipt, signed out, the kit hidden the moment the request lands —
 * and Review's removal requests, where an operator sees the runner's
 * other photos (D-117, R-145 c) and takes the kit down —
 * then D-147 (design 152): the receipt points to StopNCII and Take It
 * Down, and the takedown keeps the photo's fingerprint — then design 137's
 * limits: past two open requests, the next waits for a confirm from its
 * receipt, and the operator blocks the requester and declines the rest.
 * One journey, one video. A copy of a removed photo posted again, waiting
 * on Review with what it matched, is `takedown.spec.ts`'s.
 *
 * Needs `ADMIN_USER_IDS=e2e-desk-operator` and Cloudflare's always-pass
 * Turnstile keys in the dev server's `.dev.vars`, which CI's e2e job
 * writes. Locally, put the same lines in yours.
 *
 * Exactly one test() per journey spec.
 */
import { eq, inArray, like } from "drizzle-orm";
import { z } from "zod";

import {
  entryPhotos,
  outbox,
  outfitEntries,
  removedFingerprints,
  runs,
  takedownBlocks,
  takedownRequests,
} from "../../src/db/schema-core";
import { newUlid } from "../../src/lib/ids";
import { readOutboxRow } from "../../src/lib/sql/outbox";
import { nowSeconds } from "../../src/lib/now";
import { signInAsOperator } from "../desk/operator";
import { expect, hydrated, scene, test } from "../support/demo";
import { turnstileAnswered } from "../support/invites";
import { withLocalDb } from "../support/local-db";
import { putSamplePhotos } from "../support/media";
import { seedRunnerRow } from "./moderation-support";

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
  // D-147: the first kit's photo, by a fingerprint this run owns.
  const firstPhotoId = newUlid();
  const fingerprint = `${suffix}0f0f0f0f`;

  // Earlier runs' requests, by this demo's own address prefix: each one
  // that hid something counts toward the hour's valve (design 137), so a
  // few runs in an hour would otherwise shut it on this one.
  await withLocalDb(async ({ core }) =>
    core
      .delete(takedownRequests)
      .where(like(takedownRequests.requesterEmail, "asker-%@example.com")),
  );

  // One runner with one public kit. Scoped to ids generated here.
  await seedRunnerRow(runnerId, handle, { cityLabel: "Portland, OR" });
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
  await putSamplePhotos([otherPhotoKey]);

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
  await page.goto("/desk/review");
  await hydrated(page);
  // The row whose link is the first kit: the requester has three now.
  const request = page.locator("[data-part='removal-request']").filter({
    // By its "Open the kit": the other request's row links this kit too,
    // among the runner's other photos.
    // Round 51 · 153: it carries the row it is opened from.
    has: page.locator(`a[href^="/desk/kit/${entryId}?from=request&row="]`, {
      hasText: "Open the kit",
    }),
  });
  await expect(request.locator("[data-part='due']")).toHaveText("Due in 48h");
  await expect(request).toContainText("[via /takedown]");
  await expect(request).toContainText("[hidden]");
  await expect(request.locator("[data-part='related']")).toHaveText(
    "2 more from this requester",
  );
  await expect(request).toContainText("From Sam Asker · signed · good faith");
  await expect(request).toContainText(requester);
  const requestRow = await request.getAttribute("id");
  expect(requestRow).toMatch(/^request-/u);
  await expect(
    request.getByRole("link", { name: "Open the kit" }),
  ).toHaveAttribute(
    "href",
    `/desk/kit/${entryId}?from=request&row=${(requestRow ?? "").slice("request-".length)}`,
  );

  const others = request.locator("[data-part='other-photos']");
  await others.scrollIntoViewIfNeeded();
  await scene(page, "The runner's other photos, to check for copies");
  await expect(others).toContainText("Their other photos · 1");
  await expect(
    others.getByRole("img", { name: `${otherPhotoId}: open its kit` }),
  ).toHaveAttribute("src", `/desk/review-photo/${otherPhotoKey}`);
  await expect(others).toContainText(otherPhotoId);

  // The second kit is hidden by its own confirmed request, so its feed
  // page would send an operator away. The Desk's view of it opens (R-154,
  // #388), saying where review left it.
  await scene(page, "A hidden kit opens on the Desk, as it stands");
  await others
    .getByRole("link", { name: `${otherPhotoId}: open its kit` })
    .click();
  await expect(page).toHaveURL(
    new RegExp(String.raw`/desk/kit/${secondEntryId}\?from=request&row=`, "u"),
  );
  const deskKit = page.locator("[data-part='desk-kit']");
  // Round 52 #155.3: whose kit it is.
  await expect(deskKit.getByRole("heading", { level: 1 })).toHaveText(
    /^Kit by @/u,
  );
  // R51·153's strip: `@handle · AUDIENCE · STATE`.
  await expect(deskKit.locator("[data-part='kit-band']")).toContainText(
    " · hidden pending review",
  );
  // Round 51 · 153: when and where, under the band.
  await expect(deskKit.locator("[data-part='kit-run']")).toBeVisible();
  await expect(
    deskKit.getByRole("img", { name: otherPhotoId }),
  ).toHaveAttribute("src", `/desk/review-photo/${otherPhotoKey}`);
  // Read-only: the way on is back to the request it was opened from.
  await scene(page, "Back to the request the kit was opened from");
  await deskKit.getByRole("link", { name: "Back to the request" }).click();
  await expect(page).toHaveURL(`/desk/review#${requestRow ?? ""}`);
  await hydrated(page);

  // Round 45 #107: Decline asks why not in the bar's place, and Cancel
  // draws the bar again with what was typed kept.
  await scene(page, "Decline asks why not, in the bar's place");
  await request.getByRole("button", { name: "Decline", exact: true }).click();
  const why = request.getByLabel("Why not");
  await expect(why).toBeFocused();
  await expect(
    request.getByRole("button", { name: "Take it down" }),
  ).toHaveCount(0);
  await why.fill("Not a photo of you");
  await request.getByRole("button", { name: "Cancel" }).click();
  await expect(
    request.getByRole("button", { name: "Decline", exact: true }),
  ).toBeFocused();
  await request.getByRole("button", { name: "Decline", exact: true }).click();
  await expect(request.getByLabel("Why not")).toHaveValue("Not a photo of you");
  await page.keyboard.press("Escape");

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
  // Scoped to this run's ids, so a rerun starts from the same queue.
  await withLocalDb(async ({ core }) =>
    core
      .delete(removedFingerprints)
      .where(eq(removedFingerprints.fingerprint, fingerprint)),
  );

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
