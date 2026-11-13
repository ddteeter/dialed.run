/**
 * The styling audit's dense capture (design 205): every screen with a
 * closet, a run history, a feed and a Desk full enough to show how the
 * layout holds up. Seeded, fictional data only (`e2e/audit/dense-seed.ts`).
 * Runs only in the `audit` project, while `AUDIT_SHOTS` is set; the skill
 * `styling-audit` has the run.
 */
import type { Page } from "@playwright/test";

import { signInAsOperator } from "../desk/operator";
import { expect, test } from "../support/a11y";
import { signInAsKnownUser } from "../support/known-user";
import { press, search, see } from "./capture";
import {
  cleanAudit,
  MAYA_HANDLE,
  MAYA_ID,
  readSeed,
  seedAudit,
  settleMaya,
} from "./seed-db";

test.use({
  a11yMode: "collect",
  geolocation: { latitude: 41.88, longitude: -87.63 },
  permissions: ["geolocation"],
});
test.describe.configure({ mode: "default" });

async function asMaya(page: Page): Promise<void> {
  await signInAsKnownUser(page, MAYA_ID, MAYA_HANDLE);
  await settleMaya();
}

test("00 seed", async ({ page }) => {
  await cleanAudit();
  await asMaya(page);
  await seedAudit(page);
  await see(page, "/closet");
});

test("01 closet", async ({ page }) => {
  const seed = readSeed();
  await asMaya(page);
  await see(page, "/closet");
  for (const group of [
    "tops",
    "bottoms",
    "outer",
    "hands_head",
    "shoes",
    "socks_extras",
  ]) {
    await see(page, `/closet?group=${group}`, group);
  }
  for (const coverage of ["covered", "partial", "unknown"]) {
    await see(page, `/closet?coverage=${coverage}`, coverage);
  }
  await see(page, "/closet?from=0&to=8");
  await see(page, "/closet?retired=true");
  await see(page, "/closet?retired=true&group=shoes");
  await see(page, `/closet/${seed.halfZipId}`);
  await press(page, page.getByRole("button", { name: "Wrong?" }), "Wrong?");
  await see(page, `/closet/${seed.shoeId}`, "shoe");
  await see(page, `/closet/${seed.retiredShoeId}`);
  await see(page, `/closet/${seed.longNameId}`);
  await see(page, `/closet/edit/${seed.halfZipId}`);
  await see(page, `/closet/edit/${seed.shoeId}`);
  await see(page, "/closet/new");
});

test("02 runs", async ({ page }) => {
  const seed = readSeed();
  await asMaya(page);
  await see(page, "/runs");
  await see(page, "/runs/backlog");
  await see(page, `/runs/${seed.fullRunId}`);
  await see(page, `/runs/${seed.indoorRunId}`, "indoor");
  await see(page, `/runs/${seed.manualRunId}`, "manual");
  await see(page, `/runs/${seed.backlogRunId}`);
  await see(page, "/runs/new");
  await see(page, "/runs/manual");
  await see(page, "/runs/strava");
  await see(page, `/feed/attach/${seed.backlogRunId}`);
  await press(page, page.getByRole("button", { name: /all/iu }), "ALL sheet");
  await see(page, `/feed/attach/${seed.backlogRunId}`);
  await press(page, page.getByRole("link", { name: /all/iu }), "ALL link");
  await see(page, `/feed/verdict/${seed.unjudgedEntryId}`);
  await press(page, page.getByRole("radio", { name: "A bit cold" }), "verdict");
  await see(page, `/feed/verdict/${seed.ownEntryId}`);
});

test("03 feed", async ({ page }) => {
  const seed = readSeed();
  await asMaya(page);
  await see(page, "/feed");
  await press(
    page,
    page.getByRole("button", { name: "Your conditions" }),
    "Your conditions",
  );
  await expect(page.locator("main").first()).toBeVisible();
  await press(
    page,
    page.getByRole("button", { name: /Following|Runners you follow|Feed/u }),
    "Following tab",
  );
  await see(page, `/feed/entry/${seed.otherEntryId}`);
  await see(page, `/feed/entry/${seed.longEntryId}`);
  await see(page, `/feed/entry/${seed.ownPhotoEntryId}`);
  await see(page, `/feed/entry/${seed.ownEntryId}`, "own");
  await see(page, `/feed/entry/${seed.publicEntryId}`, "public");
  await see(page, "/feed/me");
  await see(page, `/feed/u/${seed.busyHandle}`);
  await see(page, `/feed/u/${seed.longHandle}`);
  await see(page, "/feed/u/run_with_jo");
  await see(page, "/feed/search");
  await search(page, "run");
  await see(page, "/call");
});

test("04 notifications and settings", async ({ page }) => {
  await asMaya(page);
  await see(page, "/notifications");
  for (const path of [
    "/onboarding/settings",
    "/onboarding/settings/sharing",
    "/onboarding/settings/units",
    "/onboarding/settings/notifications",
    "/account/profile",
    "/safety/blocked",
  ]) {
    await see(page, path);
  }
});

test("05 public pages", async ({ page }) => {
  const seed = readSeed();
  await asMaya(page);
  await see(page, `/@${MAYA_HANDLE}`);
  await see(page, `/kit/${seed.publicEntryId}`);
  await page.context().clearCookies();
  await see(page, `/@${MAYA_HANDLE}`);
  await see(page, `/kit/${seed.publicEntryId}`);
  await see(page, "/@tomasz_k");
});

test("06 desk", async ({ page }) => {
  await signInAsOperator(page);
  await see(page, "/desk");
  await press(
    page,
    page.getByRole("button", { name: /Show all/u }),
    "gave up: show all",
  );
  await see(page, "/desk/review");
  const rows = page
    .getByRole("listitem")
    .locator("button[aria-expanded='false']");
  await press(page, rows, "first review row");
  await press(
    page,
    page.getByRole("button", { name: /Who reported/u }),
    "who reported",
  );
  await see(page, "/desk/runners");
  for (const filter of ["reported", "flagged", "closed"]) {
    await see(page, `/desk/runners?filter=${filter}`, filter);
  }
  await see(page, "/desk/runners");
  await search(page, "run");
  await press(
    page,
    page.getByRole("button", { name: "@runner_rae" }),
    "a runner row",
  );
  await see(page, "/desk/duplicates");
  await see(page, "/desk/corrections");
  await see(page, "/desk/access");
  await see(page, "/desk/codes");
});
