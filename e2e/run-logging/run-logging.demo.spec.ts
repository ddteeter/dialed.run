/**
 * Covers: A1 (manual-temp fallback path, docs/product.md) — plus the
 * undesigned manual-entry and runs-list surfaces (docs/tasks/102-runs-import.md
 * §1; no dedicated product.md screen ID, same as auth in
 * ../auth/auth.demo.spec.ts).
 *
 * Journey: sign up -> log a run by hand (title, timing, distance, effort) ->
 * the weather module hasn't merged yet (D-24 / 102↔103 pending), so
 * conditions never resolve and the run lands on the manual-temp fallback ->
 * type a temperature -> the fallback clears -> the run shows in the runs
 * list with its weather status.
 *
 * Exactly one test() per demo spec. A second test here would record a
 * second video beside the one the reviewer is meant to watch; standalone
 * assertions belong in a sibling *.spec.ts.
 *
 * Deliberately excluded: Strava OAuth (no credentials, and the connect flow
 * redirects off-app so it can't be recorded) and file import (no fixture
 * FIT/GPX file wired into this branch yet). Both are noted in the PR
 * comment rather than faked here.
 */
import { expect, test } from "../support/demo";

/** Layout stamps html[data-hydrated] once React attaches; driving
 *  controlled inputs before that races hydration's state reset. */
async function hydrated(page: import("@playwright/test").Page): Promise<void> {
  await page
    .locator('html[data-hydrated="true"]')
    .waitFor({ state: "attached" });
}

test("signup -> log a run by hand -> manual-temp fallback -> shows in runs list", async ({
  page,
}, testInfo) => {
  // slowMo doubled to 900 (demo-legibility upgrade, PR #8) roughly doubles
  // per-action overhead across this journey's ~20 interactions; the default
  // 30s test timeout is too tight for that plus real network round-trips.
  testInfo.setTimeout(60_000);
  const email = `demo-${String(Date.now())}@example.com`;

  await page.goto("/auth/signup");
  await hydrated(page);
  await page.getByLabel("Name").fill("Demo Runner");
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill("a-long-enough-password");
  await page.getByRole("button", { name: "Sign up" }).click();
  await expect(page.getByText(email)).toBeVisible({ timeout: 15_000 });

  await page.getByRole("link", { name: "+ Add" }).click();
  await page.getByRole("link", { name: "enter it manually" }).click();
  await hydrated(page);

  await page.getByLabel("Title").fill("Demo tempo run");
  await page.getByLabel("Started").fill("2026-09-06T07:15");
  await page.getByLabel("Minutes").fill("32");
  await page.getByLabel("Distance (km)").fill("6.5");
  await page.getByLabel("Effort (optional)").selectOption("steady");
  await page.getByRole("button", { name: "Log the run" }).click();

  await expect(
    page.getByRole("heading", { name: "Demo tempo run" }),
  ).toBeVisible({ timeout: 15_000 });
  await expect(page.getByText("[UNAVAILABLE]")).toBeVisible();

  await page.getByLabel("Temp (°C)").fill("12");
  await page.getByRole("button", { name: "Save temperature" }).click();
  await expect(page.getByText("[UNAVAILABLE]")).toBeHidden({
    timeout: 15_000,
  });

  await page.goto("/runs");
  await hydrated(page);
  await expect(
    page.getByRole("link", { name: /Demo tempo run/u }),
  ).toBeVisible();
  await expect(page.getByText("[MANUAL TEMP]")).toBeVisible();
});
