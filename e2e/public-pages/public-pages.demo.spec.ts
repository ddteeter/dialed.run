/**
 * Covers: A3's PUBLIC row (round 41 #86a) and D's owner meta for a PUBLIC
 * kit, Settings › Privacy's PUBLIC PROFILE switch (#86b), `/k/<id>` as a
 * stranger sees it (#86c), `/@handle` as a stranger sees it (#86d), and
 * the not-public page a kit made private leaves behind (#86f) — design
 * 161, decisions D-150–D-153. One journey, one video.
 *
 * A3 as a whole is `e2e/verdict/`'s; this claims only the PUBLIC choice,
 * because the pages it opens are what this journey is about.
 *
 * **The stranger is this context with its cookies cleared**, not a second
 * browser context: a second context records a second video, and a public
 * page reads no session anyway (`lib/open-web.ts`). The bar's "Log in" is
 * the check that nobody is signed in. The runner's cookies are put back
 * to take the kit private.
 *
 * Photos are off locally (`PUBLIC_PHOTOS_ORIGIN` empty), so the kit has
 * none; the edge cache is off too, so a retraction shows at once rather
 * than within the minute.
 */
import { eq } from "drizzle-orm";
import type { Page } from "@playwright/test";

import { user } from "../../src/db/schema-auth";
import {
  outfitEntries,
  outfitEntryItems,
  runs,
  userProfiles,
  wardrobeItems,
} from "../../src/db/schema-core";
import { weatherObservations } from "../../src/db/schema-weather";
import { newUlid } from "../../src/lib/ids";
import { nowSeconds } from "../../src/lib/now";
import { accountEmail, storageStateFor } from "../support/accounts";
import { expect, hydrated, scene, test } from "../support/demo";
import { withLocalDb } from "../support/local-db";

test.use({ storageState: storageStateFor("public-pages") });

/**
Coordinates no other demo uses, so no other spec's observation answers ours.
*/
const LAT_R = 47.61;
const LNG_R = -122.33;

const NOTE = "Left cuff rubbed the watch.";
const RUN_TITLE = "Harbor loop past the ferry dock";

/**
A3 with a verdict and `audience` picked, not yet saved.
*/
async function pickOnA3(
  page: Page,
  entryId: string,
  audience: RegExp,
): Promise<void> {
  await page.goto(`/feed/verdict/${entryId}`);
  await hydrated(page);
  await page.getByRole("button", { name: "A bit cold" }).click();
  await page.getByRole("radio", { name: audience }).check();
}

test("make a kit and a profile public, see them as a stranger, take the kit back", async ({
  page,
}, testInfo) => {
  testInfo.setTimeout(150_000);

  const email = accountEmail("public-pages");
  const itemId = newUlid();
  const runId = newUlid();
  const entryId = newUlid();
  const startedAt = nowSeconds() - 3600;

  const handle = await withLocalDb(async ({ core, weather }) => {
    const [row] = await core
      .select({ id: user.id })
      .from(user)
      .where(eq(user.email, email))
      .limit(1);
    if (!row) throw new Error("signup did not create a user row");
    const [profile] = await core
      .select({ username: userProfiles.username })
      .from(userProfiles)
      .where(eq(userProfiles.userId, row.id))
      .limit(1);
    if (profile?.username == undefined) {
      throw new Error("the demo setup did not pick a username");
    }

    await core.insert(wardrobeItems).values({
      id: itemId,
      userId: row.id,
      name: "Houdini Jacket",
      brand: "Patagonia",
      category: "top",
      layer: "outer",
      createdAt: startedAt,
    });
    await core.insert(runs).values({
      id: runId,
      userId: row.id,
      title: RUN_TITLE,
      startedAt,
      durationS: 2700,
      distanceM: 8000,
      source: "manual",
      indoor: false,
      weatherStatus: "attached",
      lat: LAT_R,
      lng: LNG_R,
    });
    await core.insert(outfitEntries).values({
      id: entryId,
      userId: row.id,
      runId,
      audience: "runners",
      createdAt: startedAt,
    });
    await core.insert(outfitEntryItems).values({ entryId, itemId, note: NOTE });

    // Seeded, never stubbed: the observation at the run's rounded place
    // and hour is what the conditions read. Upserted, so a re-run inside
    // the same hour re-seeds rather than collides.
    await weather
      .insert(weatherObservations)
      .values({
        id: newUlid(),
        latR: LAT_R,
        lngR: LNG_R,
        hourBucket: Math.floor(startedAt / 3600),
        tempC: 6,
        feelsLikeC: 4,
        humidity: 70,
        windKph: 12,
        precipMm: 0,
        condition: "clear",
        source: "visualcrossing",
        fetchedAt: startedAt,
      })
      .onConflictDoUpdate({
        target: [
          weatherObservations.latR,
          weatherObservations.lngR,
          weatherObservations.hourBucket,
        ],
        set: { tempC: 6, feelsLikeC: 4, source: "visualcrossing" },
      });
    return profile.username;
  });

  // ---- A3 · PUBLIC is the third row ----------------------------------
  await scene(page, "A3 · who sees this run: Private, Shared, Public");
  await pickOnA3(page, entryId, /^Public/u);
  const picker = page.getByRole("group", { name: "Who sees this run" });
  await expect(picker.getByRole("radio")).toHaveCount(3);
  await scene(page, "Public says what a link preview keeps");
  await expect(
    page.getByText(/^Sites that already showed a preview of the link/u),
  ).toBeVisible();
  await page.getByRole("button", { name: "Log it" }).click();
  await expect(page.getByRole("button", { name: "Log it" })).toHaveCount(0, {
    timeout: 15_000,
  });

  // ---- D · the owner's meta -----------------------------------------
  await scene(page, "D · [PUBLIC], with Copy link and Change");
  await page.goto(`/feed/entry/${entryId}`);
  await hydrated(page);
  const meta = page.locator("[data-part='owner-meta']");
  await expect(meta).toContainText("Public");
  await expect(meta).toContainText("Public: anyone with the link can see it.");
  await expect(meta.getByRole("button", { name: "Copy link" })).toBeVisible();
  await expect(meta.getByRole("link", { name: "Change" })).toBeVisible();

  // ---- Settings › Privacy · the public profile ----------------------
  await scene(page, "Settings › Privacy · the public profile, off");
  await page.goto("/onboarding/settings/sharing");
  await hydrated(page);
  const newRuns = page.getByRole("group", { name: "Who sees new runs" });
  // D-150: PUBLIC is a default only once the profile is public.
  await expect(newRuns.getByRole("radio")).toHaveCount(2);
  const profileSwitch = page.getByRole("checkbox", { name: "Public profile" });
  await expect(profileSwitch).not.toBeChecked();
  await expect(profileSwitch).toHaveAccessibleDescription(
    `Off. Anyone signed out who opens app.dialed.run/@${handle} sees nothing. Public runs still open from their own links.`,
  );
  await scene(page, "On saves at once, and names the address");
  // `click`, not `check`: the switch is not optimistic (§4a).
  await profileSwitch.click();
  await expect(profileSwitch).toBeChecked({ timeout: 15_000 });
  await expect(profileSwitch).toHaveAccessibleDescription(
    `Anyone can see your public runs at app.dialed.run/@${handle}. No sign-in.`,
  );
  await scene(page, "Show my closet appears, and New runs gains Public");
  const closetSwitch = page.getByRole("checkbox", { name: "Show my closet" });
  await expect(closetSwitch).not.toBeChecked();
  await closetSwitch.click();
  await expect(closetSwitch).toBeChecked({ timeout: 15_000 });
  await expect(newRuns.getByRole("radio")).toHaveCount(3);

  // ---- A stranger ---------------------------------------------------
  const runnerCookies = await page.context().cookies();
  await page.context().clearCookies();

  await scene(page, "Signed out · /k/<id> is the kit, for anyone");
  const kitPage = await page.goto(`/k/${entryId}`);
  expect(kitPage?.status()).toBe(200);
  await hydrated(page);
  await expect(page.getByRole("link", { name: "Log in" })).toBeVisible();
  await expect(
    page.getByRole("heading", { level: 1, name: `@${handle}` }),
  ).toBeVisible();
  await expect(page.locator("[data-part='stats']")).toBeVisible();
  await expect(page.getByText("Houdini Jacket")).toBeVisible();
  await scene(page, "Never when or where, and never a note");
  await expect(page.getByText(RUN_TITLE)).toHaveCount(0);
  await expect(page.getByText(NOTE)).toHaveCount(0);
  await expect(
    page.getByRole("link", { name: "Request an invite" }),
  ).toBeVisible();

  await scene(page, "Signed out · /@handle lists the public kits");
  const profilePage = await page.goto(`/@${handle}`);
  expect(profilePage?.status()).toBe(200);
  await hydrated(page);
  await expect(
    page.getByRole("heading", { level: 1, name: `@${handle}` }),
  ).toBeVisible();
  const kits = page.locator("[data-part='kits']");
  await expect(kits.getByRole("heading", { level: 2 })).toHaveText(
    /^Kits\s*1$/u,
  );
  await expect(kits.locator(`a[href="/k/${entryId}"]`)).toBeVisible();
  await scene(page, "Show my closet: the rotation, read-only");
  await expect(page.getByRole("heading", { name: "Rotation" })).toBeVisible();
  await expect(page.getByText("Houdini Jacket")).toBeVisible();

  // ---- The runner takes the kit back -------------------------------
  await page.context().addCookies(runnerCookies);
  await scene(page, "Signed in again · the kit goes back to Private");
  await pickOnA3(page, entryId, /^Private/u);
  await page.getByRole("button", { name: "Log it" }).click();
  await expect(page.getByRole("button", { name: "Log it" })).toHaveCount(0, {
    timeout: 15_000,
  });

  await page.context().clearCookies();
  // The page left with `max-age=60`, so the browser that opened it above
  // may keep its own copy for that minute — the TTL design 161 makes the
  // guarantee. The visitor here is a new one, with nothing cached.
  const devtools = await page.context().newCDPSession(page);
  await devtools.send("Network.clearBrowserCache");
  await devtools.detach();
  await scene(page, "A new visitor · the same link says nothing is there");
  const gone = await page.goto(`/k/${entryId}`);
  expect(gone?.status()).toBe(404);
  await hydrated(page);
  await expect(
    page.getByRole("heading", {
      level: 1,
      name: "Nothing to see at this link",
    }),
  ).toBeVisible();
  await expect(
    page.getByText(
      "A kit shows here only while the runner who logged it keeps it public.",
    ),
  ).toBeVisible();
  // #86f: the not-public page never names whose it was.
  await expect(page.getByText(`@${handle}`)).toHaveCount(0);
  await expect(page.getByText("Houdini Jacket")).toHaveCount(0);

  await scene(page, "And the profile drops it: no public kits");
  await page.goto(`/@${handle}`);
  await hydrated(page);
  await expect(page.locator("[data-part='kits']")).toContainText(
    "No public kits yet.",
  );
});
