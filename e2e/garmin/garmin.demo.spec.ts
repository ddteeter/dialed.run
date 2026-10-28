/**
 * Covers: Import from Garmin on A1 (plan 157, phase 1; design G3), the
 * hand-off to A1's own parsed card, Garmin's credit on it (G1), A3's
 * effort read from the watch (G5), the credit on the runs list, and the
 * picker marking a run already here.
 *
 * Journey: the owner opens A1 -> the picker lists their last runs on
 * Garmin -> a tap imports the newest -> the parsed card lands, credited to
 * Garmin -> A2: pick a piece -> A3 opens with the effort the watch rated
 * (2 of 10: easy) already picked -> log it -> the runs list credits
 * Garmin -> back on A1 the run reads IMPORTED and opens it.
 *
 * **The whole app, end to end, against a stub.** Garmin's Personal API is
 * `e2e/garmin/stub-server.ts`, which Playwright starts beside the dev
 * server; everything between is the app's own: the server functions
 * reading the bindings, the client, the unzipper, R2, the queue, the
 * consumer and the FIT parser.
 *
 * **The owner is configuration, not data**: the feature is the runner's
 * whose id `GARMIN_OWNER_USER_ID` names, so the journey signs up and
 * becomes that id (`signInAsKnownUser`). The dev server's `.dev.vars`
 * needs the three Garmin lines CI writes (`.dev.vars.example`).
 *
 * Exactly one test() per demo spec.
 */
import { GARMIN_OWNER_ID } from "./stub-runs";
import { hydrated, seedItem, unseed } from "../conformance/logging-fixtures";
import type { Seeded } from "../conformance/logging-fixtures";
import { expect, scene, test } from "../support/demo";
import { signInAsKnownUser } from "../support/known-user";

const OWNER_HANDLE = "garmin_owner";

test("import a run from Garmin: the picker, the credit, the watch's effort", async ({
  page,
}, testInfo) => {
  testInfo.setTimeout(180_000);

  await signInAsKnownUser(page, GARMIN_OWNER_ID, OWNER_HANDLE);
  const seeded: Seeded = {
    userId: GARMIN_OWNER_ID,
    runIds: [],
    itemIds: [],
    entryIds: [],
  };
  // A previous local run's imports and runs: the stub's runs are the same
  // runs each time, so they would read as already here.
  await unseed(seeded);
  await seedItem(seeded, "Garmin demo tee", "top");

  try {
    await page.goto("/runs/new");
    await hydrated(page);

    // ---- A1 · the picker ----------------------------------------------
    await scene(page, "A1 · the owner's last runs on Garmin, under the well");
    const picker = page.getByRole("region", {
      name: "IMPORT FROM GARMIN · LAST 10",
    });
    const imports = picker.getByRole("button", { name: /^Import / });
    await expect(imports).toHaveCount(3, { timeout: 20_000 });

    await scene(page, "One tap fetches the run and reads it here");
    await imports.first().click();

    // ---- the parsed card, credited --------------------------------------
    await expect(page.getByText(/^Parsed · Garmin · /u)).toBeVisible({
      timeout: 20_000,
    });
    await scene(page, "A1's own parsed card, credited to Garmin");
    await expect(picker).toHaveCount(0);
    await page
      .getByRole("link", { name: "Looks right — what did you wear?" })
      .click();
    await hydrated(page);

    // ---- A2 → A3 · the effort the watch rated ---------------------------
    await page.getByRole("button", { name: "Garmin demo tee" }).click();
    await page.getByRole("button", { name: "Next — did it work?" }).click();
    await page.waitForURL("**/feed/verdict/**");
    await hydrated(page);

    await scene(page, "A3 · the effort is the watch's own rating: 2 of 10");
    const effort = page.getByRole("group", { name: "Effort" });
    await expect(effort).toHaveAccessibleDescription(
      "From your watch, rated 2 of 10",
    );
    await expect(effort.getByRole("button", { name: "Easy" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    await page.getByRole("button", { name: "Dialed" }).click();
    await page.getByRole("button", { name: "Log it" }).click();
    await expect(page.locator('[data-slot="noted"]')).toBeVisible({
      timeout: 15_000,
    });

    // ---- the runs list, and the picker again ----------------------------
    await page.goto("/runs");
    await hydrated(page);
    await scene(page, "Runs · Garmin credited on the run it sent");
    await expect(page.locator('[data-part="garmin-attribution"]')).toHaveCount(
      1,
    );

    await page.goto("/runs/new");
    await hydrated(page);
    await scene(page, "Back on A1, the run reads IMPORTED and opens");
    const imported = page.getByRole("link", { name: /^Imported: open / });
    await expect(imported).toHaveCount(1, { timeout: 20_000 });
    await imported.click();
    await expect(page).toHaveURL(/\/runs\/[0-9A-Z]{26}$/u);
    await expect(
      page.locator('[data-part="garmin-attribution"]').first(),
    ).toBeVisible();
  } finally {
    await unseed(seeded);
  }
});
