/**
 * Covers: D8 (Desk · Runners: Rename and Close account), the review
 * queue's Remove that deletes, and round 28 #8's review row (the row
 * opens itself), then the author's run after a Remove (round 27 #20,
 * R-140: the band in place of the entry, naming the rule, C8), and the
 * bell's moderation notices (C8, D-132, D-145): the author's when a report
 * hides their kit, and the reporter's when a person removes what they
 * reported, and a garment photo's owner when a person removes it (R-167,
 * design 159) — one journey, one video.
 *
 * `moderation.spec.ts` holds the rest of the Desk's moderation: suspected
 * CSAM asking again, a photo whose file is missing, a flagged handle's
 * Keep, the quarantine's NCMEC report, a copyright hold's counter-notice,
 * court action and end, and D8's flag on the poster of an upheld
 * intimate-image removal.
 *
 * The journey needs `ADMIN_USER_IDS=e2e-desk-operator` in the dev server's
 * `.dev.vars`, which CI's e2e job writes (register R-72). Locally, put the
 * same line in yours.
 *
 * Exactly one test() per journey spec.
 */
import { and, eq, inArray } from "drizzle-orm";

import {
  moderationActions,
  notifications,
  outfitEntries,
  reports,
  reviewQueue,
  runs,
  userProfiles,
  wardrobeItems,
} from "../../src/db/schema-core";
import { newUlid } from "../../src/lib/ids";
import { nowSeconds } from "../../src/lib/now";
import { userIdOf } from "../conformance/logging-fixtures";
import { signInAsOperator } from "../desk/operator";
import { expect, hydrated, scene, test } from "../support/demo";
import { withLocalDb } from "../support/local-db";
import { openRow, seedRunnerRow, signInAsAccount } from "./moderation-support";

test("an operator renames and closes a runner, and a Remove deletes", async ({
  page,
}, testInfo) => {
  testInfo.setTimeout(150_000);
  const suffix = String(Date.now()).slice(-8);
  const runnerId = newUlid();
  const handle = `rude_${suffix}`;
  const runId = newUlid();
  const entryId = newUlid();
  const queueId = newUlid();
  const now = nowSeconds();
  // The safety account: it reported the entry the Desk removes, and owns
  // the kit the operator reports (C8).
  const authorId = await userIdOf("safety");
  const sharedRunId = newUlid();
  const sharedEntryId = newUlid();
  const garmentId = newUlid();

  // One runner with one reported public entry. Scoped to ids generated
  // here — never a bare delete of these tables.
  await seedRunnerRow(runnerId, handle, { cityLabel: "Portland, OR" });
  await withLocalDb(async ({ core }) => {
    await core.insert(runs).values({
      id: runId,
      userId: runnerId,
      source: "manual",
      startedAt: now - 3600,
      durationS: 1800,
      distanceM: 5000,
      lat: 45.52,
      lng: -122.68,
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
      id: queueId,
      subjectType: "entry",
      subjectId: entryId,
      source: "reports",
      status: "pending",
      createdAt: now - 600,
    });
    // The bell's C8 rows from an earlier run of this demo go first, so the
    // ones it shows are this run's. Scoped to the account and the kinds.
    await core
      .delete(notifications)
      .where(
        and(
          eq(notifications.userId, authorId),
          inArray(notifications.kind, [
            "content_hidden",
            "report_removed",
            "photo_missing",
          ]),
        ),
      );
    // Its report, by the safety account, which is told the outcome (C8).
    await core.insert(reports).values({
      id: newUlid(),
      reporterId: authorId,
      subjectType: "entry",
      subjectId: entryId,
      reason: "spam",
      createdAt: now - 900,
    });
    // A kit the safety account shared, which the operator reports below.
    await core.insert(runs).values({
      id: sharedRunId,
      userId: authorId,
      source: "manual",
      startedAt: now - 10_800,
      durationS: 1800,
      distanceM: 5000,
      lat: 45.52,
      lng: -122.68,
      indoor: false,
      title: "Lunch loop",
    });
    await core.insert(outfitEntries).values({
      id: sharedEntryId,
      runId: sharedRunId,
      userId: authorId,
      verdict: 0,
      audience: "runners",
      createdAt: now - 10_800,
    });
    // A garment of the safety account's whose photo the classifier
    // flagged (design 157), which the Desk removes and its owner is told
    // of (R-167, design 159). No bytes: the row's image is not the point.
    await core.insert(wardrobeItems).values({
      id: garmentId,
      userId: authorId,
      category: "top",
      name: "Flagged tee",
      origin: "manual",
      photoKey: `items/${authorId}/${garmentId}/${newUlid()}`,
      visibility: "hidden_pending_review",
      createdAt: now - 1200,
    });
    await core.insert(reviewQueue).values({
      id: newUlid(),
      subjectType: "garment",
      subjectId: garmentId,
      source: "classifier",
      status: "pending",
      createdAt: now - 1200,
    });
  });

  await signInAsOperator(page);

  // C8 (D-145): one report of an intimate image hides a kit at once, and
  // its author is told in the bell. Shown on the author's side at the end.
  await page.goto(`/feed/entry/${sharedEntryId}`);
  await hydrated(page);
  await scene(page, "A report hides a kit at once, and its author is told");
  await page.getByRole("button", { name: "Report this entry" }).click();
  await page
    .getByRole("radio", {
      name: "It's an intimate image of someone, shared without their consent",
    })
    .click();
  await page.getByRole("button", { name: "Send report" }).click();
  // Round 42: an intimate-image report swaps the sheet for its receipt,
  // with the other-sites line last, and Done closes it.
  const receipt = page.locator("[data-part='report-receipt']");
  await expect(
    receipt.getByRole("heading", { name: "Thanks for telling us." }),
  ).toBeFocused();
  await expect(receipt).toContainText("We'll review it within a day");
  await expect(
    receipt.getByRole("link", { name: "StopNCII.org (opens in a new tab)" }),
  ).toBeVisible();
  await receipt.getByRole("button", { name: "Done" }).click();
  await expect(page.locator("dialog[open]")).toHaveCount(0);

  await scene(page, "Review: one row opens at a time");
  await page.goto("/desk/review");
  await hydrated(page);
  const row = page.getByRole("listitem").filter({ hasText: entryId });
  // Round 28 #8: the row's name opens it; there is no "Decide this one".
  await openRow(row);
  await expect(row.locator("button[aria-expanded]")).toHaveAttribute(
    "aria-expanded",
    "true",
  );
  const reason = row.getByRole("combobox", { name: /Why it comes down/ });

  await scene(page, "Review: Remove deletes, and says why");
  await reason.selectOption("it's an ad or spam");
  await row.getByRole("button", { name: "Remove", exact: true }).click();
  await expect(
    page.getByRole("listitem").filter({ hasText: entryId }),
  ).toHaveCount(0);

  // R-167 (design 159): a garment photo's Remove takes it off the garment
  // and tells its owner, shown in the bell at the end.
  await scene(page, "Review: Remove a garment's photo, and its owner is told");
  const garmentRow = page
    .getByRole("listitem")
    .filter({ hasText: `garment photo · ${garmentId}` });
  await openRow(garmentRow);
  // Round 42 #88: the photo at F's card size, and the garment's line.
  await expect(garmentRow.locator("[data-part='garment-photo']")).toBeVisible();
  await expect(garmentRow.locator("[data-part='garment-line']")).toBeVisible();
  await garmentRow
    .getByRole("combobox", { name: /Why it comes down/ })
    .selectOption("it's sexual or explicit");
  await garmentRow.getByRole("button", { name: "Remove", exact: true }).click();
  await expect(
    page.getByRole("listitem").filter({ hasText: garmentId }),
  ).toHaveCount(0);

  await scene(page, "D8: find the runner by email");
  await page.goto("/desk/runners");
  await hydrated(page);
  await page.getByRole("searchbox").fill(`${handle}@example.com`);
  await page.getByRole("searchbox").press("Enter");
  await page.getByRole("button", { name: `@${handle}` }).click();

  await scene(page, "Rename: a reason from the list, and a placeholder");
  await page
    .getByRole("combobox", { name: /Why the name has to go/ })
    .selectOption("Offensive or sexual");
  await page.getByRole("button", { name: "Rename" }).click();
  await expect(page.getByText(/^Renamed to @runner_\d{4}\.$/)).toBeVisible();

  await scene(page, "Close account: the reason, and the rule it names (C8)");
  await page.getByRole("textbox", { name: /Why/ }).fill("Spam accounts");
  await page
    .getByRole("combobox", { name: /Which rule it breaks/ })
    .selectOption("Post spam, advertising or promotion we have not allowed");
  await page.getByRole("button", { name: "Close account" }).click();
  await expect(page.getByText("[CLOSED]")).toBeVisible();

  const left = await withLocalDb(async ({ core }) => ({
    entries: await core
      .select({ id: outfitEntries.id })
      .from(outfitEntries)
      .where(eq(outfitEntries.id, entryId)),
    audit: await core
      .select({ action: moderationActions.action })
      .from(moderationActions)
      .where(eq(moderationActions.subjectOwnerId, runnerId)),
    notice: await core
      .select({ body: notifications.body })
      .from(notifications)
      .where(eq(notifications.userId, runnerId)),
    profile: await core
      .select({ bannedAt: userProfiles.bannedAt })
      .from(userProfiles)
      .where(eq(userProfiles.userId, runnerId)),
  }));
  expect(left.entries).toStrictEqual([]);
  expect(
    left.audit
      .map((a) => a.action)
      .toSorted((one, other) => one.localeCompare(other)),
  ).toStrictEqual(["ban", "remove", "rename"]);
  expect(left.notice.map((n) => n.body)).toContain(
    "A moderator removed this entry from the feed: it's an ad or spam.",
  );
  expect(left.profile[0]?.bannedAt).toEqual(expect.any(Number));

  // R-140: the author's side of a Remove. The demo runner above has no
  // login, so the band is shown on the safety account's own run: a run
  // whose entry the Desk removed, with the audit row exactly as
  // moderateContent writes it, run_id read before the delete.
  const removedRunId = newUlid();
  await withLocalDb(async ({ core }) => {
    await core.insert(runs).values({
      id: removedRunId,
      userId: authorId,
      source: "manual",
      startedAt: now - 7200,
      durationS: 1800,
      distanceM: 5000,
      lat: 45.52,
      lng: -122.68,
      indoor: false,
      title: "Evening loop",
    });
    await core.insert(moderationActions).values({
      id: newUlid(),
      actorId: "e2e-desk-operator",
      action: "remove",
      subjectType: "entry",
      subjectId: newUlid(),
      subjectOwnerId: authorId,
      reason: "it's an ad or spam",
      createdAt: now,
      runId: removedRunId,
    });
  });
  // The same browser, signed in as the author instead, so the journey
  // stays one video.
  await signInAsAccount(page, "safety");
  await page.goto(`/runs/${removedRunId}`);
  await hydrated(page);
  // After the navigation, so the caption holds on the page it describes.
  await scene(
    page,
    "The author's run: the band where the entry was, and the rule",
  );
  const band = page.locator(
    "[data-part='run-removals'] [data-part='notice-band']",
  );
  await expect(band).toHaveText(
    "Removed from the feedA moderator removed this entry from the feed: it's an ad or spam.That breaks our community rules: don't post spam, advertising or promotion we have not allowed.",
  );

  // C8: the bell. The hide's notice to the kit's author, and the outcome
  // to the runner who reported the entry the Desk removed above.
  await page.goto("/notifications");
  await hydrated(page);
  await scene(
    page,
    "The bell: the author told of the hide, the reporter of the outcome",
  );
  const rows = page.locator("[data-part='notification-row']");
  await expect(
    rows.filter({ hasText: "Kit hidden while we review it." }),
  ).toHaveText(
    /Kit hidden while we review it\. Someone reported a kit you shared, so other runners can't see it until a person reviews it, usually within a day\. It was hidden automatically\. We'll tell you what we decide\./u,
  );
  await expect(
    rows.filter({ hasText: "We removed what you reported." }),
  ).toHaveCount(1);
  // R-167: the garment photo's owner, in the owner's approved words.
  await expect(
    rows
      .filter({ hasText: "We removed the photo of one of your garments." })
      .locator("p"),
  ).toHaveText(
    "We removed the photo of one of your garments. Reason: it's sexual or explicit.",
  );
});
