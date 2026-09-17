/**
 * Covers: W1 (report an entry or a runner), W2 (blocked runners) — one
 * journey, one video.
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
import { newUlid } from "../../src/lib/ids";
import {
  outfitEntries,
  runs,
  userProfiles,
} from "../../src/db/schema-core";
import { storageStateFor } from "../support/accounts";
import { expect, scene, test } from "../support/demo";
import { withLocalDb } from "../support/local-db";

test.use({ storageState: storageStateFor("safety") });

/**
Layout stamps html[data-hydrated] once React attaches.
*/
async function hydrated(page: import("@playwright/test").Page): Promise<void> {
  await page
    .locator('html[data-hydrated="true"]')
    .waitFor({ state: "attached" });
}

test("report a runner, block them, and take the block back", async ({
  page,
}) => {
  const suffix = String(Date.now());
  const strangerId = newUlid();
  const strangerName = `Demo Stranger ${suffix}`;
  const runId = newUlid();
  const entryId = newUlid();
  const startedAt = Math.floor(Date.now() / 1000) - 3 * 3600;

  // One stranger with one public entry. Scoped to ids generated here —
  // never a bare delete of these tables.
  await withLocalDb(async ({ core }) => {
    await core.insert(userProfiles).values({
      userId: strangerId,
      displayName: strangerName,
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
      isPublic: true,
      createdAt: startedAt,
    });
  });

  await page.goto(`/feed/u/${strangerId}`);
  await hydrated(page);

  await scene(page, "W1 · anyone can report, and it costs them nothing");
  await expect(
    page.getByRole("heading", { name: strangerName }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Report" }).click();

  await scene(page, "Reasons are sentences a runner would say");
  await expect(
    page.getByRole("radio", { name: "Harassment aimed at someone" }),
  ).toBeVisible();
  await page.getByRole("radio", { name: "Harassment aimed at someone" }).click();

  await scene(page, "Three promises, and the code keeps all three");
  await expect(page.getByText(/A person reads it within a day/)).toBeVisible();
  await expect(
    page.getByText(/hidden from your feed straight away/),
  ).toBeVisible();
  await expect(page.getByText(/never told who/)).toBeVisible();

  await scene(page, "Blocking rides with the report, not a second request");
  await page.getByRole("checkbox", { name: `Block ${strangerName} as well` }).click();
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
  await expect(
    page.getByText(/verdicts count in anonymous/),
  ).toBeVisible();

  await scene(page, "They are on the list, and they were never told");
  await expect(page.getByText(strangerName)).toBeVisible();

  await scene(page, "Unblocking is immediate, with nothing to confirm");
  await page.getByRole("button", { name: "Unblock" }).click();
  await expect(page.getByText(strangerName)).toBeHidden();
  await expect(page.getByText("Nobody. That's normal.")).toBeVisible();
});
