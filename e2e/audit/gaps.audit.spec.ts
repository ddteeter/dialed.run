/**
 * The styling audit's gaps capture (design 205): the states neither the
 * dense capture nor the suite reaches. Settings sections, uploads in
 * flight, Strava, a run with no weather, a brand-new runner, onboarding
 * with real data and the Desk's removal requests. Seeded, fictional data
 * only (`e2e/audit/gaps-plan.ts`, over the dense seed). Runs only in the
 * `audit` project, while `AUDIT_SHOTS` is set, after `dense.audit.spec.ts`;
 * the skill `styling-audit` has the run.
 */
import type { Page } from "@playwright/test";
import { and, eq, gt, notLike, sql } from "drizzle-orm";

import {
  entryPhotos,
  notifications,
  outfitEntries,
  reports,
  reviewQueue,
  runConditions,
  runs,
  stravaConnections,
} from "../../src/db/schema-core";
import { nowSeconds } from "../../src/lib/now";
import { answerFind, holdForever } from "../conformance/feed-support";
import { gpx, seedItem, unseed } from "../conformance/logging-fixtures";
import type { Seeded } from "../conformance/logging-fixtures";
import { signInAsOperator } from "../desk/operator";
import { GARMIN_OWNER_ID } from "../garmin/stub-runs";
import { expect, test } from "../support/a11y";
import { signInAsKnownUser } from "../support/known-user";
import { withLocalDb } from "../support/local-db";
import { attempt, note, press, see, settle, shoot } from "./capture";
import {
  EMPTY_HANDLE,
  EMPTY_ID,
  NOWHERE,
  ONBOARD_HANDLE,
  ONBOARD_ID,
  observeNowhere,
  readGaps,
  resetRunner,
  seedGaps,
  settleRunner,
} from "./gaps-db";
import { MAYA_HANDLE, MAYA_ID, readSeed, settleMaya } from "./seed-db";

test.use({ a11yMode: "collect" });
test.describe.configure({ mode: "default" });

const DROP = '[data-part="drop-zone"]';
const SERVER_FN = "**/_serverFn/**";

/**
Maya's Strava reminders newer than `since`.
*/
function reminders(since: number) {
  return and(
    eq(notifications.userId, MAYA_ID),
    eq(notifications.kind, "strava_reminder"),
    gt(notifications.createdAt, since),
  );
}

async function asMaya(page: Page): Promise<void> {
  await signInAsKnownUser(page, MAYA_ID, MAYA_HANDLE);
  await settleMaya();
}

/**
 * Holds every server-function POST until the returned release is called,
 * so a screen can be shot while its request is in flight. Released, the
 * request goes through, or fails with a 500 when `outcome` says so.
 */
async function holdPosts(
  page: Page,
  outcome: "through" | "fail",
): Promise<() => void> {
  const gate = Promise.withResolvers<undefined>();
  await page.route(SERVER_FN, async (route) => {
    if (route.request().method() !== "POST") {
      await route.fallback();
      return;
    }
    await gate.promise;
    await (outcome === "fail"
      ? route.fulfill({ status: 500, body: "{}" })
      : route.fallback());
  });
  return () => {
    gate.resolve(undefined);
  };
}

/**
Drops a file on the upload screen.
*/
async function drop(
  page: Page,
  file: { name: string; mimeType: string; buffer: Buffer },
): Promise<void> {
  await page.setInputFiles(`${DROP} input[type="file"]`, file);
}

/**
Maya's runs made since `known`, and their conditions, removed.
*/
async function removeRunsSince(known: ReadonlySet<string>): Promise<void> {
  await withLocalDb(async ({ core }) => {
    const after = await core
      .select({ id: runs.id })
      .from(runs)
      .where(eq(runs.userId, MAYA_ID));
    for (const row of after) {
      if (known.has(row.id)) continue;
      await core.batch([
        core.delete(runConditions).where(eq(runConditions.runId, row.id)),
        core.delete(runs).where(eq(runs.id, row.id)),
      ]);
    }
    try {
      await core.run(sql`delete from imports where user_id = ${MAYA_ID}`);
    } catch (error) {
      note(`imports not cleared: ${String(error)}`);
    }
  });
}

test("00 seed the gaps", async ({ page }) => {
  await asMaya(page);
  const gaps = await seedGaps();
  expect(gaps.matchPhotoId).not.toBe("");
});

test.describe("as the dense runner", () => {
  test.use({
    geolocation: { latitude: 41.88, longitude: -87.63 },
    permissions: ["geolocation"],
  });

  test("01 settings and account, every section", async ({ page }) => {
    await asMaya(page);
    await page.goto("/onboarding/settings");
    await settle(page);
    const links = await page.evaluate(() =>
      [
        ...globalThis.document.querySelectorAll<HTMLAnchorElement>(
          "main a[href]",
        ),
      ].map((anchor) => anchor.pathname + anchor.search),
    );
    const wanted = new Set<string>([
      "/account/sign-in",
      "/account/email",
      "/account/password",
      "/account/notifications",
      "/account/username",
      ...links.filter(
        (href) =>
          (href.startsWith("/account/") ||
            href.startsWith("/onboarding/calibrate")) &&
          !href.includes("export"),
      ),
    ]);
    // Every section is one route (`/account/$section`), so each needs a
    // key of its own to count as a state.
    for (const [index, href] of [...wanted].entries()) {
      await see(page, href, `s${String(index + 1)}`);
    }
    await see(page, "/account/sign-in");
    await press(
      page,
      page.getByRole("button", { name: "Delete account" }),
      "delete account sheet",
    );
    await see(page, "/account/password");
    await press(
      page,
      page.getByRole("button", { name: /Change password|Save|Update/u }),
      "password: empty submit",
    );
    await see(page, "/account/email");
    await press(
      page,
      page.getByRole("button", { name: /Change|Save|Send|Update/u }),
      "email: empty submit",
    );
    await see(page, "/account/notifications");
    await press(
      page,
      page.getByRole("checkbox").or(page.getByRole("switch")),
      "notifications: one toggled",
    );
  });

  test("02 blocked runners", async ({ page }) => {
    await asMaya(page);
    await see(page, "/safety/blocked");
  });

  test("03 the whole closet", async ({ page }) => {
    await asMaya(page);
    await see(page, "/closet");
  });

  test("04 upload: in progress, parsed, failed, duplicate", async ({
    page,
  }) => {
    await asMaya(page);
    const before = await withLocalDb(({ core }) =>
      core.select({ id: runs.id }).from(runs).where(eq(runs.userId, MAYA_ID)),
    );
    const run = {
      name: "Lakefront_tempo_2026-11-12.gpx",
      mimeType: "application/gpx+xml",
    };
    try {
      const startedAt = Math.floor(nowSeconds() / 60) * 60 - 5 * 3600;
      await see(page, "/runs/new");
      // In progress: the parse is held in flight while the shot is taken.
      const release = await holdPosts(page, "through");
      await drop(page, { ...run, buffer: gpx(startedAt, 42) });
      await attempt("upload in progress", async () => {
        await expect(page.locator(DROP)).toBeVisible();
        await shoot(page, "upload in progress");
      });
      release();
      await page.unroute(SERVER_FN);
      await attempt("upload parsed", async () => {
        await expect(page.locator('[data-slot="parsed-card"]')).toBeVisible({
          timeout: 30_000,
        });
        await shoot(page, "upload parsed");
      });
      // The same file again: the duplicate receipt.
      await see(page, "/runs/new", "dup");
      await drop(page, { ...run, buffer: gpx(startedAt, 42) });
      await attempt("upload duplicate", async () => {
        await expect(page.locator('[data-slot="parsed-card"]')).toBeVisible({
          timeout: 30_000,
        });
        await shoot(page, "upload duplicate");
      });
      // A file with no track: failed.
      await see(page, "/runs/new", "failed");
      await drop(page, {
        name: "MORNING_RUN_NO_TRACK.GPX",
        mimeType: "application/gpx+xml",
        buffer: gpx(startedAt - 86_400, 1),
      });
      await attempt("upload failed", async () => {
        await expect(page.locator("#drop-zone-message")).toBeVisible({
          timeout: 30_000,
        });
        await shoot(page, "upload failed");
      });
      // Not a run file at all.
      await see(page, "/runs/new", "wrong");
      await drop(page, {
        name: "holiday-photo-from-the-lakefront-with-a-very-long-file-name.jpg",
        mimeType: "image/jpeg",
        buffer: Buffer.from("not a run"),
      });
      await attempt("upload wrong type", async () => {
        await expect(page.locator("#drop-zone-message")).toBeVisible({
          timeout: 30_000,
        });
        await shoot(page, "upload wrong type");
      });
    } finally {
      await removeRunsSince(new Set(before.map((row) => row.id)));
    }
  });

  test("05 strava: refused, connected, a reminder, the disconnect confirm", async ({
    page,
  }) => {
    await asMaya(page);
    const athleteId = String(
      900_000_000 + Math.floor(nowSeconds() % 1_000_000),
    );
    try {
      await see(page, "/runs/strava-callback?error=access_denied");
      await see(
        page,
        "/runs/strava-callback?code=not-a-real-code&state=nope",
        "badstate",
      );
      await withLocalDb(async ({ core }) => {
        await core.batch([
          core
            .delete(stravaConnections)
            .where(eq(stravaConnections.userId, MAYA_ID)),
          core.insert(stravaConnections).values({
            userId: MAYA_ID,
            athleteId,
            refreshToken: `audit-refresh-${athleteId}`,
            connectedAt: nowSeconds() - 9 * 86_400,
          }),
        ]);
      });
      const posted = await page.request.post("/api/strava", {
        data: {
          object_type: "activity",
          object_id: Number(athleteId) + 1,
          aspect_type: "create",
          owner_id: Number(athleteId),
          subscription_id: 1,
          event_time: nowSeconds(),
          updates: { title: "Never read" },
        },
      });
      if (!posted.ok())
        note(`strava webhook answered ${String(posted.status())}`);
      await attempt("strava reminder landing", async () => {
        await expect(async () => {
          const landed = await withLocalDb(({ core }) =>
            core
              .select({ id: notifications.id })
              .from(notifications)
              .where(reminders(nowSeconds() - 300)),
          );
          expect(landed.length).toBeGreaterThan(0);
        }).toPass({ timeout: 30_000 });
        await see(page, "/notifications", "strava");
      });
      await see(page, "/runs/strava", "connected");
      await press(
        page,
        page.getByRole("button", { name: "Disconnect" }),
        "strava disconnect confirm",
      );
      await see(page, "/onboarding/settings", "strava");
    } finally {
      const lately = reminders(nowSeconds() - 600);
      await withLocalDb(async ({ core }) => {
        await core.batch([
          core
            .delete(stravaConnections)
            .where(eq(stravaConnections.userId, MAYA_ID)),
          core.delete(notifications).where(lately),
        ]);
      });
    }
  });

  test("07 manual entry: field errors, submitting, a failure band, no weather", async ({
    page,
  }) => {
    const gaps = readGaps();
    const next = page.getByRole("button", { name: "Next · pick the outfit" });
    await asMaya(page);
    await see(page, "/runs/manual");
    await press(page, next, "manual: empty submit, field errors");
    await attempt("manual: bad values", async () => {
      await page
        .getByLabel("Title")
        .fill(
          "Thursday threshold session along the lakefront path, out to Montrose and back",
        );
      await page.getByLabel("Started").fill("2031-01-01T07:15");
      await page.getByLabel("Minutes").fill("-4");
      await page.getByLabel("Distance (km)").fill("0");
      await next.click();
      await shoot(page, "manual: bad values");
    });
    await attempt("manual: submitting, then the failure band", async () => {
      await see(page, "/runs/manual", "busy");
      await page.getByLabel("Title").fill("Thursday threshold");
      await page.getByLabel("Started").fill("2026-11-10T06:40");
      await page.getByLabel("Minutes").fill("52");
      await page.getByLabel("Distance (km)").fill("11.2");
      const release = await holdPosts(page, "fail");
      await next.click({ noWaitAfter: true });
      await expect(page.locator("form").first()).toBeVisible();
      await shoot(page, "manual: submitting");
      release();
      await expect(
        page.locator("[data-part='failure-band']").first(),
      ).toBeVisible({ timeout: 15_000 });
      await shoot(page, "manual: failure band");
    });
    await page.unrouteAll({ behavior: "ignoreErrors" });
    // R2b: a run whose weather never came.
    if (gaps.failedRunId === "") {
      note("no run with failed weather in the dense seed");
    } else {
      await see(page, `/runs/${gaps.failedRunId}`, "noweather");
      await attempt("R2b no weather, set by hand", async () => {
        await page
          .getByRole("button", { name: "Set conditions" })
          .or(page.getByRole("link", { name: "Set conditions" }))
          .first()
          .click({ timeout: 4000 });
        await shoot(page, "R2b no weather saved");
        const dialog = page.locator("dialog[open]");
        await press(
          page,
          page
            .getByRole("button", {
              name: /Set (it|conditions) by hand|Set conditions|Pick/u,
            })
            .last(),
          "R2b picking",
        );
        await press(
          page,
          dialog.getByRole("radio").nth(3),
          "R2b a band picked",
        );
        await press(
          page,
          dialog.getByRole("radio", { name: /rain/iu }),
          "R2b a sky picked",
        );
      });
    }
    if (gaps.pendingRunId === "") {
      note("no run with pending weather in the dense seed");
    } else {
      await see(page, `/runs/${gaps.pendingRunId}`, "fetching");
    }
  });

  test("08 entry detail: copy link, delete confirms, the report receipt", async ({
    page,
  }) => {
    const seed = readSeed();
    await asMaya(page);
    await page
      .context()
      .grantPermissions(["clipboard-read", "clipboard-write", "geolocation"]);
    await see(page, `/feed/entry/${seed.publicEntryId}`, "share");
    await press(
      page,
      page.getByRole("button", { name: "Copy link" }),
      "AF1 copy link pressed",
    );
    await press(
      page,
      page.getByRole("button", { name: "Delete this entry" }),
      "delete entry confirm",
    );
    await see(page, `/feed/entry/${seed.ownPhotoEntryId}`, "photo");
    await press(
      page,
      page.getByRole("button", { name: "Delete photo 1" }),
      "delete photo confirm",
    );

    const mayaReport = and(
      eq(reports.reporterId, MAYA_ID),
      eq(reports.subjectId, seed.otherEntryId),
    );
    const heldPhotos = and(
      eq(entryPhotos.entryId, seed.otherEntryId),
      eq(entryPhotos.screenStatus, "hidden_pending_review"),
      notLike(entryPhotos.id, "audit-g%"),
    );
    const cleanReport = () =>
      withLocalDb(async ({ core }) => {
        await core.batch([
          core.delete(reports).where(mayaReport),
          core
            .delete(reviewQueue)
            .where(eq(reviewQueue.subjectId, seed.otherEntryId)),
          core
            .update(outfitEntries)
            .set({ moderationStatus: "ok" })
            .where(eq(outfitEntries.id, seed.otherEntryId)),
          core
            .update(entryPhotos)
            .set({ screenStatus: "pass" })
            .where(heldPhotos),
        ]);
      });
    await cleanReport();
    try {
      await see(page, `/feed/entry/${seed.otherEntryId}`, "report");
      await press(
        page,
        page.getByRole("button", { name: "Report this entry" }),
        "report sheet",
      );
      // Only an intimate-image report has a receipt (round 42); any other
      // reason closes the sheet on a status line.
      await press(
        page,
        page.getByRole("radio", {
          name: "It's an intimate image of someone, shared without their consent",
        }),
        "report sheet, intimate picked",
      );
      await attempt("report sheet, confirmation ticked", async () => {
        await page
          .locator("dialog[open]")
          .getByRole("checkbox")
          .first()
          .check({ timeout: 2000 });
      });
      await press(
        page,
        page.getByRole("button", { name: "Send report" }),
        "report receipt",
      );
    } finally {
      await cleanReport();
    }
    await see(page, `/feed/u/${seed.longHandle}`, "block");
    await press(
      page,
      page.getByRole("button", { name: /^Report or block /u }),
      "report or block sheet",
    );
    await press(
      page,
      page.getByRole("radio", { name: "Harassment aimed at someone" }),
      "report or block, a reason picked",
    );
    await press(
      page,
      page.getByRole("checkbox", { name: /^Block .* as well$/u }),
      "report or block, block ticked",
    );
  });

  test("09 feed: a photo that loads, and matched conditions", async ({
    page,
  }) => {
    await asMaya(page);
    await see(page, "/feed", "photos");
    await press(
      page,
      page.getByRole("button", { name: /Following|Runners you follow/u }),
      "following tab",
    );
    const broken = await page.evaluate(
      () =>
        [...globalThis.document.querySelectorAll("img")].filter(
          (image) => !image.complete || image.naturalWidth === 0,
        ).length,
    );
    if (broken > 0) note(`feed: ${String(broken)} images did not load`);
    await press(
      page,
      page.getByRole("button", { name: "Your conditions" }),
      "your conditions, matched",
    );
  });
});

test("06 garmin: the picker, then the parsed card", async ({ page }) => {
  await signInAsKnownUser(page, GARMIN_OWNER_ID, "garmin_owner");
  await resetRunner(GARMIN_OWNER_ID);
  await settleRunner(GARMIN_OWNER_ID, {
    cityLabel: "Chicago, IL",
    lat: 41.88,
    lng: -87.63,
  });
  const seeded: Seeded = {
    userId: GARMIN_OWNER_ID,
    runIds: [],
    itemIds: [],
    entryIds: [],
  };
  await seedItem(seeded, "Tracksmith Harrier Tee", "top");
  try {
    await see(page, "/runs/new");
    const picker = page.getByRole("region", {
      name: "IMPORT FROM GARMIN · LAST 10",
    });
    const imports = picker.getByRole("button", { name: /^Import /u });
    await expect(imports.first()).toBeVisible({ timeout: 20_000 });
    await shoot(page, "garmin picker");
    await imports.first().click();
    await expect(
      page.getByText("Parsed · From Garmin", { exact: true }),
    ).toBeVisible({ timeout: 20_000 });
    await shoot(page, "garmin parsed card");
    await see(page, "/runs/new", "imported");
    await attempt("garmin picker with one imported", async () => {
      await expect(
        page.getByRole("link", { name: /^Imported: open /u }),
      ).toHaveCount(1, { timeout: 20_000 });
      await shoot(page, "garmin picker, one imported");
    });
    await see(page, "/runs", "garmin");
  } finally {
    await unseed(seeded);
    await resetRunner(GARMIN_OWNER_ID);
  }
});

/**
Types a city into Find with a canned answer, and shoots the result.
*/
async function findCity(
  page: Page,
  typed: string,
  answer: Parameters<typeof answerFind>[1],
  what: string,
): Promise<void> {
  await attempt(what, async () => {
    await answerFind(page, answer);
    await page.getByRole("textbox").first().fill(typed);
    await page.getByRole("button", { name: "Find" }).click();
    await shoot(page, what);
    await page.unroute(SERVER_FN);
  });
}

/**
Opens the Closet from the feed's tab bar, which loads a route.
*/
async function tabToCloset(page: Page): Promise<void> {
  await page
    .locator("[data-slot='tab-bar']")
    .getByRole("link", { name: "Closet" })
    .first()
    .click({ noWaitAfter: true, timeout: 5000 });
}

const EMPTY_PATHS = [
  "/closet",
  "/runs",
  "/runs/backlog",
  "/notifications",
  "/feed/me",
  "/call",
  `/@${EMPTY_HANDLE}`,
  `/feed/u/${EMPTY_HANDLE}`,
  "/safety/blocked",
  "/feed/search",
  "/runs/new",
  "/onboarding/settings",
  // X1 inside the signed-in shell, by an unknown page and by an unknown id.
  "/no-such-page",
  "/account/profile",
  "/closet/01HZZZZZZZZZZZZZZZZZZZZZZZ",
  "/feed/entry/01HZZZZZZZZZZZZZZZZZZZZZZZ",
  "/runs/01HZZZZZZZZZZZZZZZZZZZZZZZ",
  "/feed/u/nobody_by_this_name",
];

test.describe("a brand-new runner, location refused", () => {
  test("10 empty states, the city finder, system states", async ({ page }) => {
    await signInAsKnownUser(page, EMPTY_ID, EMPTY_HANDLE);
    await resetRunner(EMPTY_ID);
    await settleRunner(EMPTY_ID, undefined);
    await page.context().clearPermissions();

    await see(page, "/feed");
    await attempt("location denied", async () => {
      await expect(
        page.locator('[data-part="match-block"][data-state="location-denied"]'),
      ).toBeVisible({ timeout: 15_000 });
      await shoot(page, "your conditions, location denied");
    });
    await findCity(
      page,
      "Sprngfeild, Ilinois",
      { kind: "not-found" },
      "city finder not found",
    );
    await findCity(
      page,
      "Springfield, IL",
      { kind: "unavailable" },
      "city finder unavailable band",
    );
    await findCity(
      page,
      "Springfield, IL",
      {
        kind: "found",
        address: "Springfield, Sangamon County, Illinois, United States",
        lat: 39.8,
        lng: -89.64,
      },
      "city finder resolved",
    );
    await page.unrouteAll({ behavior: "ignoreErrors" });
    await press(
      page,
      page.getByRole("button", { name: /Following|Runners you follow/u }),
      "empty feed, following nobody",
    );

    for (const path of EMPTY_PATHS) {
      await attempt(path, () => see(page, path));
    }
    await attempt("search with no results", async () => {
      await see(page, "/feed/search", "none");
      const box = page
        .getByRole("searchbox")
        .or(page.getByRole("textbox"))
        .first();
      await box.fill("zzqx_nobody");
      await box.press("Enter");
      await shoot(page, "search, no results");
    });

    // X3 slow route, then X2 loader failed.
    await page.setViewportSize({ width: 390, height: 844 });
    await attempt("X3 slow route", async () => {
      await see(page, "/feed", "slow");
      const gate = Promise.withResolvers<undefined>();
      await page.route(SERVER_FN, async (route) => {
        await gate.promise;
        await route.fallback();
      });
      await tabToCloset(page);
      await expect(page.locator("[data-part='tab-bar']").first()).toBeVisible({
        timeout: 5000,
      });
      await shoot(page, "X3 slow route");
      gate.resolve(undefined);
      await page.unroute(SERVER_FN);
    });
    await attempt("X2 loader failed", async () => {
      await see(page, "/feed", "broken");
      await page.route(SERVER_FN, (route) =>
        route.fulfill({ status: 500, body: "{}" }),
      );
      await tabToCloset(page);
      await expect(page.locator("[data-part='system-state']")).toBeVisible({
        timeout: 15_000,
      });
      await shoot(page, "X2 loader failed");
      await page.unroute(SERVER_FN);
    });
    await page.unrouteAll({ behavior: "ignoreErrors" });
    await attempt("offline", async () => {
      await see(page, "/feed", "offline");
      await page.context().setOffline(true);
      await tabToCloset(page);
      await expect(page.locator("body")).toBeVisible({ timeout: 5000 });
      await shoot(page, "offline");
    });
    await page.context().setOffline(false);
  });
});

test.describe("a brand-new runner, location granted", () => {
  test.use({
    geolocation: { latitude: NOWHERE.lat, longitude: NOWHERE.lng },
    permissions: ["geolocation"],
  });

  test("11 your conditions: no matches, then waiting", async ({ page }) => {
    await signInAsKnownUser(page, EMPTY_ID, EMPTY_HANDLE);
    await resetRunner(EMPTY_ID);
    await settleRunner(EMPTY_ID, undefined);
    await observeNowhere(33);
    await page.goto("/feed?nomatch=1");
    await attempt("no matches", async () => {
      await expect(
        page.locator('[data-part="match-block"][data-state="no-matches"]'),
      ).toBeVisible({ timeout: 20_000 });
      await shoot(page, "your conditions, no matches");
    });
    await settleRunner(EMPTY_ID, undefined);
    await page.route(SERVER_FN, holdForever);
    await page.goto("/feed?waiting=1");
    await attempt("waiting", async () => {
      await expect(
        page.locator('[data-part="match-block"][data-state="waiting"]'),
      ).toBeVisible({ timeout: 20_000 });
      await shoot(page, "your conditions, waiting");
    });
    await page.unrouteAll({ behavior: "ignoreErrors" });
  });
});

/**
 * Ticks up to `count` unticked checkboxes in the page, from the end when
 * `isFromEnd`: the shot is of the list with many chosen, not of each tap.
 */
async function tick(
  page: Page,
  count: number,
  isFromEnd: boolean,
): Promise<void> {
  await page.evaluate(
    async ({ limit, reversed }) => {
      const boxes = [
        ...globalThis.document.querySelectorAll<HTMLInputElement>(
          'input[type="checkbox"]',
        ),
      ].filter((box) => !box.checked);
      const chosen = reversed ? boxes.slice(-limit) : boxes.slice(0, limit);
      for (const box of chosen) {
        box.click();
        await new Promise((resolve) => {
          globalThis.setTimeout(resolve, 60);
        });
      }
    },
    { limit: count, reversed: isFromEnd },
  );
}

test.describe("onboarding with real data", () => {
  test("12 calibrate with a city, the tap list mid-tap, naming, done", async ({
    page,
  }) => {
    await signInAsKnownUser(page, ONBOARD_ID, ONBOARD_HANDLE);
    await resetRunner(ONBOARD_ID);
    await settleRunner(ONBOARD_ID, undefined, false);
    await page.context().clearPermissions();

    await see(page, "/onboarding/calibrate");
    await attempt("O1 with a city chosen", async () => {
      await page.getByLabel(/^Run a little cold/u).check();
      await page.getByLabel("Where you run").fill("Minneapolis");
      await answerFind(page, {
        kind: "found",
        address: "Minneapolis, Hennepin County, Minnesota, United States",
        lat: 44.98,
        lng: -93.27,
      });
      await page.getByRole("button", { name: "Find" }).click();
      await shoot(page, "O1 city found");
      await page.getByRole("button", { name: "Use this" }).click();
      await expect(page.locator("[data-part='city-chip']")).toBeVisible({
        timeout: 10_000,
      });
      await shoot(page, "O1 city chosen");
      await page.unroute(SERVER_FN);
      await page.getByRole("button", { name: "Start running" }).click();
      await page.waitForURL("**/onboarding/taplist**", { timeout: 15_000 });
    });
    await page.unrouteAll({ behavior: "ignoreErrors" });

    await see(page, "/onboarding/taplist");
    await attempt("P2 mid-tap", async () => {
      await tick(page, 9, false);
      await shoot(page, "P2 nine chosen");
      await page.getByRole("button", { name: /Everything else/u }).click();
      await settle(page);
      await tick(page, 6, true);
      await shoot(page, "P2 everything else open, many chosen");
      await page.getByRole("button", { name: "Next" }).click();
      await page.waitForURL("**/onboarding/name**", { timeout: 15_000 });
    });

    await attempt("P2.5 name the pieces", async () => {
      await see(page, "/onboarding/name");
      await page.getByRole("button", { name: "Name it" }).first().click();
      await shoot(page, "P2.5 a row open");
      await page.getByLabel("Brand").fill("Smartwool");
      await page.getByLabel("Model").fill("Intraknit Thermal Merino 200 Crew");
      await shoot(page, "P2.5 a row open, typed");
      await page.getByRole("button", { name: "Save" }).click();
      await expect(page.getByText(/1 of \d+ named/u)).toBeVisible({
        timeout: 10_000,
      });
      await shoot(page, "P2.5 one named");
      await page.getByRole("button", { name: "Name it" }).nth(1).click();
      await page.getByRole("button", { name: "Save" }).click();
      await shoot(page, "P2.5 a row open, empty save");
    });
    await see(page, "/onboarding/done");
    await see(page, "/closet", "generic");
    await see(page, "/call", "start");
    await see(page, "/onboarding/handle");
  });
});

/**
Opens review rows one by one until one shows twelve or more matches.
*/
async function openMatchGrid(page: Page): Promise<number> {
  return page.evaluate(async () => {
    const openers = [
      ...globalThis.document.querySelectorAll<HTMLButtonElement>(
        "li button[aria-expanded='false']",
      ),
    ];
    for (const opener of openers) {
      opener.click();
      await new Promise((resolve) => {
        globalThis.setTimeout(resolve, 500);
      });
      const tiles = globalThis.document.querySelectorAll(
        "[data-part='match-distance']",
      ).length;
      if (tiles >= 12) return tiles;
    }
    return 0;
  });
}

test("13 desk: removal requests, holds, quarantine, the match grid, close account", async ({
  page,
}) => {
  await signInAsOperator(page);
  await see(page, "/desk/review");
  for (const part of [
    "removal-request",
    "copyright-hold",
    "quarantine-record",
  ]) {
    const count = await page.locator(`[data-part='${part}']`).count();
    if (count === 0) note(`desk review: no ${part} on the page`);
  }
  await attempt("a removal request, its decision open", async () => {
    const request = page.locator("[data-part='removal-request']").first();
    await request.scrollIntoViewIfNeeded();
    await request.getByRole("button").first().click();
    await shoot(page, "removal request, first control pressed");
  });
  await attempt("copyright hold: delete confirm", async () => {
    await see(page, "/desk/review", "hold");
    const remove = page.getByRole("button", { name: "Case over: delete" });
    await page
      .locator("[data-part='copyright-hold']")
      .filter({ has: remove })
      .first()
      .getByRole("button", { name: "Case over: delete" })
      .click();
    await shoot(page, "copyright hold, delete confirm");
  });
  await attempt("the match grid, more than twelve", async () => {
    await see(page, "/desk/review", "matches");
    // Opened in the page: only the row with the matches is worth a shot.
    const tiles = await openMatchGrid(page);
    if (tiles === 0) note("desk review: no row showed twelve matches");
    await shoot(page, "review row with the match grid");
  });

  await see(page, "/desk/runners", "close");
  await attempt("D3 close account", async () => {
    await page.getByRole("searchbox").fill("runner_rae");
    await page.getByRole("searchbox").press("Enter");
    await page
      .getByRole("button", { name: "@runner_rae" })
      .click({ timeout: 8000 });
    await settle(page);
    await page.getByRole("button", { name: "Close account" }).last().click();
    await shoot(page, "close account, empty submit or opened");
    await page
      .getByRole("textbox", { name: "Why" })
      .fill(
        "Spam: the same shop link in every kit, after two removals and a warning.",
      );
    await page
      .getByRole("combobox", { name: /Which rule/u })
      .selectOption({ index: 1 });
    await shoot(page, "close account, filled");
  });
  for (const filter of ["reported", "flagged", "closed"]) {
    await attempt(`runner column: ${filter}`, async () => {
      await see(page, `/desk/runners?filter=${filter}`, "open");
      await page
        .getByRole("row")
        .getByRole("button", { name: /^@/u })
        .first()
        .click({ timeout: 5000 });
      await shoot(page, `runner column: ${filter}`);
    });
  }
});
