/**
 * Covers: A1 (manual-temp fallback path, docs/product.md) — plus the
 * undesigned manual-entry and runs-list surfaces (docs/tasks/102-runs-import.md
 * §1; no dedicated product.md screen ID, same as auth in
 * ../auth/auth.demo.spec.ts).
 *
 * Journey: open the closet -> launch the log flow from the bar -> log a run
 * by hand (title, timing, distance, effort) -> the weather module hasn't
 * merged yet (D-24 / 102↔103 pending), so conditions never resolve and the
 * run lands on the manual-temp fallback -> type a temperature -> the
 * fallback clears -> the run shows in the runs list with its weather status.
 *
 * **It opens on the closet rather than on `/runs/new`, and that is the
 * point of the first beat** (task 117). A `page.goto` is a document load,
 * which is a first paint — NAV types it `cut`, so a demo that jumps
 * straight to a screen records none of the move that gets it there. Going
 * in through the bar records two things at once: the `rise` that lays the
 * flow over where the runner was, and D-80's other half — the Closet tab
 * stays lit underneath, because `+ Add` is a launcher and not a tab.
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
import { storageStateFor } from "../support/accounts";
import { DESK, PHONE, bar, launcher } from "../support/bars";
import { expect, scene, test } from "../support/demo";

// Signed in already: the account is created by the `demo-setup` project, so
// this video opens on logging a run rather than on a signup form.
test.use({ storageState: storageStateFor("run-logging") });

/** Layout stamps html[data-hydrated] once React attaches; driving
 *  controlled inputs before that races hydration's state reset. */
async function hydrated(page: import("@playwright/test").Page): Promise<void> {
  await page
    .locator('html[data-hydrated="true"]')
    .waitFor({ state: "attached" });
}

test("log a run by hand -> manual-temp fallback -> shows in runs list", async ({
  page,
}, testInfo) => {
  // Generous, because recording pace is not a latency budget. `scene()`
  // holds a beat at each boundary and slowMo paces the actions between
  // them (D-58), so a recorded run takes minutes where CI's takes seconds.
  // A timeout here is for catching a hang.
  testInfo.setTimeout(60_000);
  await page.goto("/closet");
  await hydrated(page);

  // **Phone width for this beat, deliberately.** Everything below is the
  // five-tab footer's own behaviour — the held tab, the sliding indicator,
  // the launcher that takes a seat without owning a path — and from
  // BREAKPOINT.wide up there is no footer at all (Desktop Contract DS1).
  // Pinning the width here is what stops the phone layout rotting
  // silently now that the demo project's canvas is finally the right one
  // for the top bar.
  await page.setViewportSize(PHONE);

  await scene(
    page,
    "Phone width, on purpose — the five-tab bar exists only below 720",
  );
  await scene(page, "Logging a run is laid over wherever you were");
  await launcher(page).click();
  await hydrated(page);
  // The launcher takes no seat of its own, and the indicator stays under
  // the second of five — the closet, where the runner came from.
  //
  // The indicator rather than `aria-current`: `Link` owns that attribute
  // and sets it on the route the runner is actually on, which is
  // `/runs/new`. Holding the *highlight* is what the launcher row asks
  // for; claiming they are on a page they are not would be a different
  // thing, and a worse one for a screen reader.
  // Before D-80 the bar rendered no indicator at all here, so its mere
  // presence is the change; that it is the closet's is the label beside it.
  await expect(page.locator('[data-slot="tab-indicator"] span')).toBeVisible();
  await expect(bar(page).getByRole("link", { name: "Closet" })).toHaveClass(
    /text-ink/u,
  );

  // The half of that a unit test cannot see. `getByRole` resolves
  // Chromium's real accessibility tree, and the launcher's name is computed
  // from re-nested markup — the shape that shipped "Useful [ 1 ]" in task
  // 114 and was caught only here.
  //
  // Expected reading, per the Accessibility Contract's round-12 row:
  // "Closet, link, current, 2 of 5" · "Add, button, dialog".
  await expect(
    bar(page).getByRole("link", { name: "Closet" }),
  ).toHaveAttribute("aria-current", "true");
  await expect(launcher(page)).toHaveAttribute("aria-haspopup", "dialog");
  // "No tab is `page` during the flow; the flow screen announces itself."
  await expect(bar(page).locator('[aria-current="page"]')).toHaveCount(0);

  // **Back to the desk canvas.** The beat above is the phone bar's, and
  // without this the rest of the journey — manual entry, the run detail,
  // the runs list — records at 390 on a 1280 canvas, which is the exact
  // thing this lane was built to stop showing.
  await scene(page, "…and back to the desk, where the top bar replaces it");
  await page.setViewportSize(DESK);

  await scene(page, "Weather is never typed — manual is the fallback");
  await page.getByRole("link", { name: "Enter the run by hand" }).click();
  await hydrated(page);

  await scene(page, "Log a run: what, when, how long, how far");
  await page.getByLabel("Title").fill("Demo tempo run");
  await page.getByLabel("Started").fill("2026-09-06T07:15");
  await page.getByLabel("Minutes").fill("32");
  await page.getByLabel("Distance (km)").fill("6.5");
  await page.getByLabel("Effort (optional)").selectOption("steady");
  await page.getByRole("button", { name: "Log run" }).click();

  await expect(
    page.getByRole("heading", { name: "Demo tempo run" }),
  ).toBeVisible({ timeout: 15_000 });
  await expect(page.getByText("[Unavailable]")).toBeVisible();

  await scene(page, "No observation resolved, so the runner may say");
  await page.getByLabel("Temp (°C)").fill("12");
  await page.getByRole("button", { name: "Save temperature" }).click();
  await expect(page.getByText("[Unavailable]")).toBeHidden({
    timeout: 15_000,
  });

  await scene(page, "And it is marked manual wherever it is read");
  await page.goto("/runs");
  await hydrated(page);
  await expect(
    page.getByRole("link", { name: /Demo tempo run/u }),
  ).toBeVisible();
  await expect(page.getByText("[Manual temp]")).toBeVisible();
});
