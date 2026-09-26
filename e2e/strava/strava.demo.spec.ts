/**
 * Covers: T1 (connect, with Strava's official button — round 26 #21), T3a
 * (connected, "LAST RUN SEEN" — round 25), T3b (disconnect: kept and
 * stops), S1 (the reminder a run landing on Strava leaves — round 25) and
 * O3's Strava slot (the same button on onboarding's close).
 *
 * Journey: T1 not connected -> press the official button and see our
 * brackets beside it -> the connect redirect heads for Strava's authorize
 * screen -> (connected, seeded: Strava's consent screen is off-app) -> a
 * run lands on Strava, posted to our webhook -> S1 shows the reminder ->
 * T3a says when the last run was seen -> disconnect through T3b -> T1 again
 * -> O3's slot carries the same button.
 *
 * **It needs Strava configured**: `STRAVA_CLIENT_ID`, `STRAVA_CLIENT_SECRET`
 * and `STRAVA_SUBSCRIPTION_ID` in `.dev.vars` (placeholders are enough —
 * nothing here reaches Strava). T1 draws nothing unconfigured, which is its
 * rule. CI gains the three placeholders with task 125's CI change (owner,
 * 2026-09-26).
 *
 * Exactly one test() per demo spec.
 */
import { and, eq } from "drizzle-orm";

import {
  notifications,
  stravaConnections,
  stravaRevocations,
} from "../../src/db/schema-core";
import { newUlid } from "../../src/lib/ids";
import { nowSeconds } from "../../src/lib/now";
import { hydrated, userIdOf } from "../conformance/logging-fixtures";
import { storageStateFor } from "../support/accounts";
import { expect, scene, test } from "../support/demo";
import { withLocalDb } from "../support/local-db";

test.use({ storageState: storageStateFor("run-logging") });

/**
 * The `STRAVA_SUBSCRIPTION_ID` the placeholder `.dev.vars` carries.
 */
const SUBSCRIPTION_ID = 1;

test("Strava: connect with the official button, a reminder lands, disconnect", async ({
  page,
}, testInfo) => {
  testInfo.setTimeout(180_000);
  const userId = await userIdOf("run-logging");
  const athleteId = String(900_000_000 + Math.floor(nowSeconds() % 1_000_000));
  const refreshToken = `demo-refresh-${newUlid()}`;

  try {
    // ---- T1 · the official button -------------------------------------
    await scene(page, "T1 · Strava's own Connect button, in our link");
    await page.goto("/runs/strava");
    await hydrated(page);
    const button = page.getByRole("link", { name: "Connect with Strava" });
    await expect(button).toBeVisible();
    await expect(button).toHaveAttribute("data-part", "strava-button");
    await expect(button.locator("img")).toHaveAttribute(
      "src",
      "/strava/btn_strava_connect_with_orange.svg",
    );

    // The connect is a server redirect to Strava's consent screen, which
    // is off-app: hold the navigation so the in-flight state is on film.
    await page.route("**/runs/strava-connect", (route) =>
      route.fulfill({ status: 204 }),
    );
    await scene(page, "Pressed: our brackets beside it, the asset untouched");
    await button.click();
    await expect(page.getByText("[Connecting]")).toBeVisible();
    await page.unroute("**/runs/strava-connect");

    const redirect = await page.request.get("/runs/strava-connect", {
      maxRedirects: 0,
    });
    expect(redirect.status()).toBe(302);
    expect(redirect.headers().location).toMatch(
      /^https:\/\/www\.strava\.com\/oauth\/authorize\?/u,
    );

    // ---- Connected (seeded: the consent screen is Strava's) -----------
    await withLocalDb(async ({ core }) => {
      await core.insert(stravaConnections).values({
        userId,
        athleteId,
        accessToken: "demo-access",
        refreshToken,
        expiresAt: nowSeconds() + 3600,
        connectedAt: nowSeconds() - 60,
      });
    });

    // ---- A run lands on Strava ----------------------------------------
    await scene(page, "A run lands on Strava: the webhook, then the reminder");
    const posted = await page.request.post("/api/strava", {
      data: {
        object_type: "activity",
        object_id: Number(athleteId) + 1,
        aspect_type: "create",
        owner_id: Number(athleteId),
        subscription_id: SUBSCRIPTION_ID,
        event_time: nowSeconds(),
        updates: { title: "Never read" },
      },
    });
    expect(posted.status()).toBe(200);

    await expect(async () => {
      await page.goto("/notifications");
      await expect(
        page.getByText(
          "New run on Strava · Add it here: upload the file, then what you wore",
        ),
      ).toBeVisible({ timeout: 1000 });
    }).toPass({ timeout: 30_000 });
    // Nothing about the run itself: no title, no distance.
    await expect(page.getByText("Never read")).toHaveCount(0);

    // ---- T3a · connected, and when a run was last seen ----------------
    await scene(page, "T3a · connected, and when the last run was seen");
    await page.goto("/runs/strava");
    await hydrated(page);
    await expect(page.getByText(/^Connected · Last run seen /u)).toBeVisible();
    await expect(
      page.getByRole("link", { name: "Connect with Strava" }),
    ).toHaveCount(0);

    // ---- T3b · disconnect ---------------------------------------------
    await scene(page, "T3b · what is kept, what stops");
    await page.getByRole("button", { name: "Disconnect" }).click();
    const confirm = page.locator('[data-slot="disconnect-confirm"]');
    await expect(confirm).toContainText("Stops");
    await expect(confirm).toContainText("The reminder after each run");
    await confirm.getByRole("button", { name: "Disconnect" }).click();
    await hydrated(page);
    await expect(
      page.getByRole("link", { name: "Connect with Strava" }),
    ).toBeVisible({ timeout: 15_000 });

    // ---- O3 · the same button on onboarding's close --------------------
    await scene(page, "O3 · the same button where our pill was");
    await page.goto("/onboarding/done");
    await hydrated(page);
    await expect(
      page.getByRole("link", { name: "Connect with Strava" }),
    ).toBeVisible();
  } finally {
    await withLocalDb(async ({ core }) => {
      await core
        .delete(stravaConnections)
        .where(eq(stravaConnections.userId, userId));
      await core
        .delete(stravaRevocations)
        .where(eq(stravaRevocations.refreshToken, refreshToken));
      await core
        .delete(notifications)
        .where(
          and(
            eq(notifications.userId, userId),
            eq(notifications.kind, "strava_reminder"),
          ),
        );
    });
  }
});
