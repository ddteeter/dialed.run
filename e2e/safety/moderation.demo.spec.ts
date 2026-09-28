/**
 * Covers: D8 (Desk · Runners: Rename and Close account), the review
 * queue's Remove that deletes — one journey, one video.
 *
 * The journey needs `ADMIN_USER_IDS=e2e-desk-operator` in the dev server's
 * `.dev.vars`, which CI's e2e job writes (register D-72). Locally, put the
 * same line in yours.
 *
 * Exactly one test() per demo spec.
 */
import { eq } from "drizzle-orm";

import { user } from "../../src/db/schema-auth";
import {
  moderationActions,
  notifications,
  outfitEntries,
  reviewQueue,
  runs,
  userProfiles,
} from "../../src/db/schema-core";
import { newUlid } from "../../src/lib/ids";
import { nowSeconds } from "../../src/lib/now";
import { signInAsOperator } from "../desk/operator";
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
  const now = nowSeconds();

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
      isPublic: true,
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
  });

  await signInAsOperator(page);

  await scene(page, "Review: Remove deletes, and says why");
  await page.goto("/safety/review");
  await hydrated(page);
  const row = page.getByRole("listitem").filter({ hasText: entryId });
  const pick = row.getByRole("button", { name: "Decide this one" });
  if (await pick.isVisible()) await pick.click();
  await row
    .getByRole("combobox", { name: /Why it comes down/ })
    .selectOption("it's an ad or spam");
  await row.getByRole("button", { name: "Remove", exact: true }).click();
  await expect(
    page.getByRole("listitem").filter({ hasText: entryId }),
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

  await scene(page, "Close account: the reason their notice quotes");
  await page.getByRole("textbox", { name: /Why/ }).fill("Spam accounts");
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
});
