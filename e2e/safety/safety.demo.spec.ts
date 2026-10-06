/**
 * Covers: W1 (report an entry or a runner), W2 (blocked runners) — one
 * journey, one video. Round 22 (items 21–22): the foot link, W1 from an
 * entry with no block toggle, ✕ discarding, W2's empty line, and Unblock
 * leaving on success. Task 128: a report hides the entry from the
 * reporter at once (SAF-13), a block hides the blocked runner's entries
 * (SAF-12), and unblocking brings them back.
 *
 * Exactly one test() per demo spec. A second here would record a second
 * video beside the one the reviewer is meant to watch.
 *
 * **What this is for**: the launch gate is a promise about what happens
 * when a stranger posts something wrong, and that promise is mostly copy.
 * A reviewer should watch a report get filed and see the three sentences
 * it makes — a person reads it, the entry goes from your feed straight
 * away, the author is never told who reported them — rather than infer
 * them from a diff.
 */
import { user } from "../../src/db/schema-auth";
import { newUlid } from "../../src/lib/ids";
import { outfitEntries, runs, userProfiles } from "../../src/db/schema-core";
import { storageStateFor } from "../support/accounts";
import { expect, hydrated, scene, test } from "../support/demo";
import { withLocalDb } from "../support/local-db";
import { nowSeconds } from "../../src/lib/now";

test.use({ storageState: storageStateFor("safety") });

test("report a runner, block them, and take the block back", async ({
  page,
}) => {
  const suffix = String(Date.now());
  const strangerId = newUlid();
  const strangerName = `stranger_${suffix.slice(-8)}`;
  const runId = newUlid();
  const entryId = newUlid();
  const reportedRunId = newUlid();
  const reportedEntryId = newUlid();
  const startedAt = nowSeconds() - 3 * 3600;

  // One stranger with one public entry. Scoped to ids generated here —
  // never a bare delete of these tables.
  await withLocalDb(async ({ core }) => {
    // A confirmed account: H shows only those (design 133, D-113 Q2).
    await core.insert(user).values({
      id: strangerId,
      name: strangerName,
      email: `${strangerName}@example.com`,
      emailVerified: true,
      createdAt: new Date(startedAt * 1000),
      updatedAt: new Date(startedAt * 1000),
    });
    await core.insert(userProfiles).values({
      userId: strangerId,
      username: strangerName,
      cityLabel: "Portland, OR",
    });
    await core.insert(runs).values({
      id: runId,
      userId: strangerId,
      source: "manual",
      startedAt,
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
      userId: strangerId,
      verdict: 0,
      audience: "runners",
      createdAt: startedAt,
    });
    // A second entry, the one this runner will report.
    await core.insert(runs).values({
      id: reportedRunId,
      userId: strangerId,
      source: "manual",
      startedAt: startedAt - 86_400,
      durationS: 1800,
      distanceM: 5000,
      lat: 45.52,
      lng: -122.68,
      indoor: false,
      title: "Spammy loop",
    });
    await core.insert(outfitEntries).values({
      id: reportedEntryId,
      runId: reportedRunId,
      userId: strangerId,
      verdict: 0,
      audience: "runners",
      createdAt: startedAt - 86_400,
    });
  });

  // W1 from an entry (round 22, item 21): the foot link, reasons and an
  // optional note, and no block toggle — and ✕ throws the draft away.
  await page.goto(`/feed/entry/${entryId}`);
  await hydrated(page);
  await scene(page, "W1 from an entry · a foot link, and no block toggle");
  await page.getByRole("button", { name: "Report this entry" }).click();
  await page.getByRole("radio", { name: "It's an ad, or it's spam" }).click();
  await expect(page.locator("dialog[open]").getByRole("checkbox")).toHaveCount(
    0,
  );
  await scene(page, "✕ closes and discards, with no confirm");
  await page.getByRole("button", { name: "Close" }).click();
  await expect(page.locator("dialog[open]")).toHaveCount(0);
  await page.getByRole("button", { name: "Report this entry" }).click();
  await expect(
    page.getByRole("radio", { name: "It's an ad, or it's spam" }),
  ).not.toBeChecked();
  await page.getByRole("button", { name: "Close" }).click();

  // SAF-13: the report is the hide, for the reporter, straight away.
  await page.goto(`/feed/entry/${reportedEntryId}`);
  await hydrated(page);
  await scene(page, "Report an entry, and it leaves your feed at once");
  await page.getByRole("button", { name: "Report this entry" }).click();
  await page.getByRole("radio", { name: "It's an ad, or it's spam" }).click();
  await page.getByRole("button", { name: "Send report" }).click();
  await expect(page.locator("dialog[open]")).toHaveCount(0);
  await page.goto(`/feed/entry/${reportedEntryId}`);
  await scene(page, "Its link now leads back to the feed — for you alone");
  await expect(page).not.toHaveURL(new RegExp(reportedEntryId));

  await page.goto(`/feed/u/${strangerId}`);
  await hydrated(page);

  await scene(page, "W1 · anyone can report, and it costs them nothing");
  await expect(page.getByRole("heading", { name: strangerName })).toBeVisible();
  await page
    .getByRole("button", { name: `Report or block ${strangerName}` })
    .click();

  await scene(page, "Reasons are sentences a runner would say");
  await expect(
    page.getByRole("radio", { name: "Harassment aimed at someone" }),
  ).toBeVisible();
  await page
    .getByRole("radio", { name: "Harassment aimed at someone" })
    .click();

  await scene(page, "Three promises, and the code keeps all three");
  await expect(page.getByText(/A person reads it within a day/)).toBeVisible();
  await expect(
    page.getByText(/hidden from your feed straight away/),
  ).toBeVisible();
  await expect(page.getByText(/never told who/)).toBeVisible();

  await scene(page, "Blocking rides with the report, not a second request");
  await page
    .getByRole("checkbox", { name: `Block ${strangerName} as well` })
    .click();
  await page.getByRole("button", { name: "Send report" }).click();
  // Wait for the report to land before navigating. Without this the goto
  // below raced the server function: the block row was written, but after
  // the blocked-runners page had already read an empty list — which is a
  // flake that fails as "they were never blocked" and sends the reader
  // looking at the wrong code.
  //
  // The signal is the sheet closing, not its "Report sent." status. Both
  // happen in the same tick — `onSuccess` fires `onFiled` and `onClose`
  // together — so at recording speed the status is already inside a
  // closed dialog by the time it is asked about, and reads as hidden
  // rather than absent. Waiting on the dialog works at both speeds, and
  // it is what a runner actually sees.
  await expect(page.locator("dialog[open]")).toHaveCount(0);

  await scene(page, "W2 · the explanation carries the screen, not the list");
  await page.goto("/safety/blocked");
  await hydrated(page);
  await expect(
    page.getByRole("heading", { name: /what blocking does/i }),
  ).toBeVisible();
  await expect(page.getByText(/verdicts count in anonymous/)).toBeVisible();

  await scene(page, "They are on the list, and they were never told");
  await expect(page.getByText(strangerName)).toBeVisible();

  // SAF-12: a block hides, both ways — their entry is gone from here.
  await page.goto(`/feed/entry/${entryId}`);
  await scene(page, "Blocked, their entries are gone from everywhere you look");
  await expect(page).not.toHaveURL(new RegExp(entryId));
  await page.goto("/safety/blocked");
  await hydrated(page);

  await scene(page, "Unblocking is immediate, with nothing to confirm");
  await page.getByRole("button", { name: "Unblock" }).click();
  await expect(page.getByText(strangerName)).toBeHidden();
  await expect(page.getByText("You haven't blocked anyone.")).toBeVisible();

  await scene(page, "Unblocked, their entry is back");
  await page.goto(`/feed/entry/${entryId}`);
  await hydrated(page);
  await expect(page).toHaveURL(new RegExp(`/feed/entry/${entryId}$`));
  await expect(
    page.getByRole("button", { name: "Report this entry" }),
  ).toBeVisible();
});
