/**
 * Covers: D0 (the Desk's shell) and Today — one journey, one video.
 *
 * **Not collected by CI yet, deliberately.** Playwright runs
 * `*.demo.spec.ts`; this is `operator.demo.ts` because the journey needs
 * `ADMIN_USER_IDS=e2e-desk-operator` in the dev server's `.dev.vars`, and
 * CI writes that file without it until the owner applies the one line in
 * `docs/proposals/125-ci-migrate-before-deploy.md` (register D-72). A demo
 * cannot skip itself (`.skip` is forbidden), so it waits under a name the
 * runner does not match. When the line lands, rename this file to
 * `operator.demo.spec.ts` and nothing else changes. Until then it is
 * recorded locally, with the same line in a local `.dev.vars`.
 *
 * Exactly one test() per demo spec.
 */
import { newUlid } from "../../src/lib/ids";
import { nowSeconds } from "../../src/lib/now";
import { count, inArray } from "drizzle-orm";

import { reviewQueue, userProfiles } from "../../src/db/schema-core";
import { expect, scene, test } from "../support/demo";
import { withLocalDb } from "../support/local-db";
import { signInAsOperator } from "./operator";

const HOUR = 3600;

test("an operator opens the Desk and reads Today", async ({ page }) => {
  // What Today counts: three more things waiting (one 19 hours old), one of
  // them a photo the screener sent, and a ban this week. Added to whatever
  // the local database already holds, never in place of it.
  const seeded = [newUlid(), newUlid(), newUlid()] as const;
  const banned = newUlid();
  const waitingBefore = await withLocalDb(async ({ core }) => {
    const [row] = await core
      .select({ rows: count() })
      .from(reviewQueue)
      .where(inArray(reviewQueue.status, ["pending", "reviewing"]));
    const now = nowSeconds();
    await core.insert(reviewQueue).values([
      {
        id: seeded[0],
        subjectType: "entry",
        subjectId: newUlid(),
        source: "reports",
        status: "pending",
        createdAt: now - 19 * HOUR,
      },
      {
        id: seeded[1],
        subjectType: "photo",
        subjectId: newUlid(),
        source: "classifier",
        status: "pending",
        createdAt: now - 2 * HOUR,
      },
      {
        id: seeded[2],
        subjectType: "profile",
        subjectId: newUlid(),
        source: "reports",
        status: "pending",
        createdAt: now - 5 * HOUR,
      },
    ]);
    await core
      .insert(userProfiles)
      .values({ userId: banned, bannedAt: now - 24 * HOUR });
    return row?.rows ?? 0;
  });
  const waiting = String(waitingBefore + 3);

  await signInAsOperator(page);

  await page.goto("/desk");
  await page
    .locator('html[data-hydrated="true"]')
    .waitFor({ state: "attached" });
  await scene(page, "The Desk: its own dark shell, reached only by address");
  const rail = page.getByRole("navigation", { name: "Desk" });
  await expect(rail.getByText("Desk", { exact: true })).toBeVisible();
  await expect(rail.getByRole("link", { name: "Today" })).toHaveAttribute(
    "aria-current",
    "page",
  );

  await scene(page, "Today: the digest's three numbers, from its own query");
  const stats = page.getByRole("listitem").filter({ hasText: "decision" });
  await expect(stats).toContainText(`${waiting}waiting for a decision`);
  await expect(stats).toContainText(/Oldest · \d+h/u);
  await expect(
    page.getByText(/photos? the screener couldn't finish/u),
  ).toBeVisible();
  await expect(page.getByText(/bans? this week/u)).toBeVisible();

  await scene(page, "Review carries the count that needs a person");
  await expect(
    rail.getByRole("link", { name: `Review ${waiting}` }),
  ).toBeVisible();

  await withLocalDb(async ({ core }) => {
    await core.delete(reviewQueue).where(inArray(reviewQueue.id, [...seeded]));
    await core
      .delete(userProfiles)
      .where(inArray(userProfiles.userId, [banned]));
  });
});
