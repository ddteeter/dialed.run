/**
 * Covers: D8 (Desk · Runners: Rename and Close account), the review
 * queue's Remove that deletes, and round 28 #8's review row (the row
 * opens itself; suspected CSAM asks again), and a flagged handle's row
 * with its Keep (round 35 #45), the quarantine with its NCMEC report
 * recorded (C12, design 145), a copyright hold's counter-notice, court
 * action and the case's end (C5, D-130, D-146), then the author's run after a Remove
 * (round 27 #20, R-140: the band in place of the entry, naming the rule,
 * C8), and the bell's moderation notices (C8, D-132, D-145): the author's
 * when a report hides their kit, and the reporter's when a person removes
 * what they reported — one journey, one video.
 *
 * The journey needs `ADMIN_USER_IDS=e2e-desk-operator` in the dev server's
 * `.dev.vars`, which CI's e2e job writes (register R-72). Locally, put the
 * same line in yours.
 *
 * Exactly one test() per demo spec.
 */
import { readFile } from "node:fs/promises";

import { and, eq, inArray } from "drizzle-orm";
import { z } from "zod";

import { user } from "../../src/db/schema-auth";
import {
  copyrightHolds,
  moderationActions,
  notifications,
  outfitEntries,
  quarantinedContent,
  reports,
  reviewQueue,
  runs,
  userProfiles,
} from "../../src/db/schema-core";
import { newUlid } from "../../src/lib/ids";
import { nowSeconds } from "../../src/lib/now";
import { userIdOf } from "../conformance/logging-fixtures";
import { signInAsOperator } from "../desk/operator";
import { storageStateFor } from "../support/accounts";
import { expect, hydrated, scene, test } from "../support/demo";
import { withLocalDb } from "../support/local-db";

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
  const flaggedId = newUlid();
  const flaggedHandle = `edgy_${suffix}`;
  const quarantineId = newUlid();
  const reportNumber = `E2E-${suffix}`;
  const holdActionId = newUlid();
  const heldPhotoId = newUlid();
  const holdOwnerId = newUlid();
  const now = nowSeconds();
  // The safety account: it reported the entry the Desk removes, and owns
  // the kit the operator reports (C8).
  const authorId = await userIdOf("safety");
  const sharedRunId = newUlid();
  const sharedEntryId = newUlid();

  // One runner with one reported public entry. Scoped to ids generated
  // here — never a bare delete of these tables.
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
          inArray(notifications.kind, ["content_hidden", "report_removed"]),
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
    // A handle the hourly re-check flagged after it was claimed (D-97),
    // waiting behind the reported entry.
    await core.insert(user).values({
      id: flaggedId,
      name: flaggedHandle,
      email: `${flaggedHandle}@example.com`,
      emailVerified: true,
      createdAt: new Date(now * 1000),
      updatedAt: new Date(now * 1000),
    });
    await core.insert(userProfiles).values({
      userId: flaggedId,
      username: flaggedHandle,
      usernameScreen: "flagged",
      usernameScreenedAt: now - 300,
    });
    await core.insert(reviewQueue).values({
      id: newUlid(),
      subjectType: "profile",
      subjectId: flaggedId,
      source: "classifier",
      status: "pending",
      createdAt: now - 300,
    });
    // A quarantined record not yet reported to NCMEC (C12). Synthetic: no
    // content and no photos, only the record's own columns.
    await core.insert(quarantinedContent).values({
      id: quarantineId,
      moderationActionId: newUlid(),
      subjectType: "entry",
      subjectId: newUlid(),
      uploaderId: runnerId,
      entryId: newUlid(),
      entrySnapshot: "{}",
      photosSnapshot: "[]",
      quarantinedAt: now,
      retainUntil: now + 365 * 86_400,
    });
    // A copyright takedown's hold (D-130, design 149), hidden today with
    // no counter-notice yet. Synthetic: the audit row and the hold only.
    await core.insert(moderationActions).values({
      id: holdActionId,
      actorId: "e2e-desk-operator",
      action: "takedown",
      subjectType: "photo",
      subjectId: heldPhotoId,
      subjectOwnerId: holdOwnerId,
      reason: `it uses someone else's work — Acme Photo Co, ref ${suffix}`,
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
  await expect(page.locator("dialog[open]")).toHaveCount(0);

  await scene(page, "Review: one row opens at a time");
  await page.goto("/safety/review");
  await hydrated(page);
  const row = page.getByRole("listitem").filter({ hasText: entryId });
  // Round 28 #8: the row's name opens it; there is no "Decide this one".
  const opener = row.locator("button[aria-expanded]");
  if ((await opener.getAttribute("aria-expanded")) === "false") {
    await opener.click();
  }
  await expect(opener).toHaveAttribute("aria-expanded", "true");
  const reason = row.getByRole("combobox", { name: /Why it comes down/ });

  await scene(page, "Suspected CSAM asks again, in the row, Cancel focused");
  await reason.selectOption("it's sexual or explicit");
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

  await scene(page, "Review: Remove deletes, and says why");
  await reason.selectOption("it's an ad or spam");
  await row.getByRole("button", { name: "Remove", exact: true }).click();
  await expect(
    page.getByRole("listitem").filter({ hasText: entryId }),
  ).toHaveCount(0);

  // Round 35 #45: a flagged handle's row says why it is there, and offers
  // Keep and Rename rather than Approve and Remove.
  await scene(page, "Review: a handle the hourly re-check flagged");
  const handleRow = page
    .getByRole("listitem")
    .filter({ hasText: flaggedHandle });
  const handleOpener = handleRow.locator("button[aria-expanded]");
  await expect(handleOpener).toHaveText(`handle · re-check · ${flaggedHandle}`);
  if ((await handleOpener.getAttribute("aria-expanded")) === "false") {
    await handleOpener.click();
  }
  await expect(
    handleRow.getByText(
      "The hourly re-check flagged a handle this runner already has. Nothing is hidden while it waits.",
    ),
  ).toBeVisible();
  await expect(handleRow.getByText("[classifier]")).toBeVisible();
  await expect(handleRow.getByRole("button", { name: "Approve" })).toHaveCount(
    0,
  );
  await handleRow.getByRole("button", { name: "Keep" }).click();
  await expect(
    page.getByRole("listitem").filter({ hasText: flaggedHandle }),
  ).toHaveCount(0);

  // C12: recording the CyberTipline report keeps the record a year from
  // the report, and the row says so at once.
  await scene(page, "Quarantine: record the NCMEC report");
  const held = page
    .locator("[data-part='quarantine-record']")
    .filter({ hasText: runnerId });
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
  await expect(held.locator("[data-part='ncmec']")).toContainText(reportNumber);

  // D-130: a copyright hold — the counter-notice sets the day it comes
  // back, and a court action cancels that and holds it until the case
  // ends (D-146), when the Desk restores or deletes it.
  await scene(
    page,
    "Copyright holds: counter-notice, court action, then the case's end",
  );
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
    quarantine: await core
      .select({
        reportedAt: quarantinedContent.ncmecReportedAt,
        reportId: quarantinedContent.ncmecReportId,
        retainUntil: quarantinedContent.retainUntil,
      })
      .from(quarantinedContent)
      .where(eq(quarantinedContent.id, quarantineId)),
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
  const report = left.quarantine[0];
  expect(report?.reportId).toBe(reportNumber);
  expect(report?.reportedAt).toBeGreaterThanOrEqual(now);
  // A year from the report, which is later than the quarantine's own year.
  expect(report?.retainUntil).toBe((report?.reportedAt ?? 0) + 365 * 86_400);

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
  const saved: unknown = JSON.parse(
    await readFile(storageStateFor("safety"), "utf8"),
  );
  const authorState = storageState.parse(saved);
  await page.context().clearCookies();
  await page.context().addCookies(authorState.cookies);
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
});

/**
One cookie of a saved Playwright session.
*/
const savedCookie = z.object({
  name: z.string(),
  value: z.string(),
  domain: z.string(),
  path: z.string(),
  expires: z.number(),
  httpOnly: z.boolean(),
  secure: z.boolean(),
  sameSite: z.enum(["Strict", "Lax", "None"]),
});

/**
The cookies of a saved Playwright session, parsed rather than trusted.
*/
const storageState = z.object({ cookies: z.array(savedCookie) });
