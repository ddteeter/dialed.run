/**
 * Covers: `/takedown` (design 136, decision D-117) — the footer's "Report
 * an intimate image", the request form and its receipt, signed out — and
 * Review's removal requests, where an operator takes the kit down. One
 * journey, one video.
 *
 * Needs `ADMIN_USER_IDS=e2e-desk-operator` and Cloudflare's always-pass
 * Turnstile keys in the dev server's `.dev.vars`, which CI's e2e job
 * writes. Locally, put the same lines in yours.
 *
 * Exactly one test() per demo spec.
 */
import { eq } from "drizzle-orm";

import { user } from "../../src/db/schema-auth";
import {
  outfitEntries,
  runs,
  takedownRequests,
  userProfiles,
} from "../../src/db/schema-core";
import { newUlid } from "../../src/lib/ids";
import { nowSeconds } from "../../src/lib/now";
import { signInAsOperator } from "../desk/operator";
import { expect, hydrated, scene, test } from "../support/demo";
import { turnstileAnswered } from "../support/invites";
import { withLocalDb } from "../support/local-db";

test("someone with no account asks for an intimate image to come down, and an operator takes it down", async ({
  page,
}, testInfo) => {
  testInfo.setTimeout(150_000);
  const suffix = String(Date.now()).slice(-8);
  const runnerId = newUlid();
  const handle = `poster_${suffix}`;
  const runId = newUlid();
  const entryId = newUlid();
  const requester = `asker-${suffix}@example.com`;
  const now = nowSeconds();

  // One runner with one public kit. Scoped to ids generated here.
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
      indoor: false,
      title: "Morning loop",
    });
    await core.insert(outfitEntries).values({
      id: entryId,
      runId,
      userId: runnerId,
      verdict: 0,
      audience: "runners",
      createdAt: now - 3600,
    });
  });

  await scene(page, "Signed out: every page's footer says where to ask");
  await page.goto("/auth/login");
  await hydrated(page);
  await page
    .locator("[data-part='legal-footer']")
    .getByRole("link", { name: "Report an intimate image" })
    .click();
  await expect(page).toHaveURL(/\/takedown$/u);
  await hydrated(page);
  await expect(
    page.getByRole("heading", {
      level: 1,
      name: "Ask us to remove an intimate image",
    }),
  ).toBeVisible();

  await scene(page, "The form asks for the Act's four parts");
  await page.getByLabel("Email").fill(requester);
  await page.getByLabel("Your full name").fill("Sam Asker");
  await page
    .getByLabel("Link to the image")
    .fill(`https://dialed.run/feed/entry/${entryId}`);
  await page.getByLabel("What it shows · optional").fill("A photo of me");
  await page.getByRole("checkbox").check();
  await turnstileAnswered(page);
  await page.getByRole("button", { name: "Send request" }).click();

  await scene(page, "The receipt: a person decides within 48 hours");
  await expect(
    page.getByRole("heading", { name: "We have your request" }),
  ).toBeVisible({ timeout: 15_000 });
  await expect(page.getByText(requester)).toBeVisible();

  // The request hides nothing (D-117): the kit is still there.
  const [stillThere] = await withLocalDb(async ({ core }) =>
    core
      .select({ id: outfitEntries.id })
      .from(outfitEntries)
      .where(eq(outfitEntries.id, entryId)),
  );
  expect(stillThere?.id).toBe(entryId);

  await signInAsOperator(page);

  await scene(page, "Review: the request, its clock, and the kit");
  await page.goto("/safety/review");
  await hydrated(page);
  const request = page
    .locator("[data-part='removal-request']")
    .filter({ hasText: requester });
  await expect(request).toContainText("[Due in 48h]");
  await expect(request).toContainText(`Sam Asker · ${requester}`);
  await expect(
    request.getByRole("link", { name: "Open the kit" }),
  ).toHaveAttribute("href", `/feed/entry/${entryId}`);

  await scene(page, "Take it down: the kit goes, and the requester is told");
  await request.getByRole("button", { name: "Take it down" }).click();
  await expect(request).toHaveCount(0, { timeout: 15_000 });

  const [gone] = await withLocalDb(async ({ core }) =>
    core
      .select({ id: outfitEntries.id })
      .from(outfitEntries)
      .where(eq(outfitEntries.id, entryId)),
  );
  expect(gone).toBeUndefined();
  const [decided] = await withLocalDb(async ({ core }) =>
    core
      .select({ status: takedownRequests.status })
      .from(takedownRequests)
      .where(eq(takedownRequests.requesterEmail, requester)),
  );
  expect(decided?.status).toBe("removed");
});
