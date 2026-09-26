/**
 * D0, the Desk's shell and Today, against Operator Screens' "D0 Desk
 * shell" frame: the rail's destinations in order, and Today's three
 * numbers in the digest's order, each with the words the board gives it.
 *
 * **Not collected by CI yet, for the same reason as
 * `e2e/desk/operator.demo.ts`:** the operator exists only with
 * `ADMIN_USER_IDS=e2e-desk-operator` in the dev server's `.dev.vars`, and
 * CI writes that file without it until the owner applies the line in
 * `docs/proposals/125-ci-migrate-before-deploy.md` (D-72). `.skip` is
 * forbidden, so it waits under a name Playwright does not match; renaming
 * it to `desk-d0.conformance.spec.ts` is the whole switch. It passes
 * locally with that line.
 *
 * What it does not compare, on purpose: the board's own values (4, 23, 3,
 * "OLDEST · 19H") are the drawing's data, not the app's; "@mara · OPERATOR
 * · SIGN OUT" is a design delta (no handle read before ACC-1, and sign-out
 * is 126's component); "SCREENING · OK / LAST DIGEST" is undrawn in words
 * the build has anything behind yet; and Access is round 26's addition to
 * the rail, after D0 was drawn.
 */
import { expect, test } from "@playwright/test";

import { leavesOf, openBoard, screen } from "../support/conformance";
import { signInAsOperator } from "../desk/operator";

const BOARD = "Operator Screens.dc.html";
const D0 = "D0 Desk shell";

/**
The rail as D0 draws it, and Today's three phrases in its order.
*/
const DRAWN_RAIL = ["Today", "Review", "Duplicates", "Gave up", "Runners"];
const DRAWN_STATS = [
  "waiting for a decision",
  "photo the screener couldn't finish",
  "bans this week",
];

test("D0: the rail's destinations and Today's three numbers, as drawn", async ({
  page,
  baseURL,
}) => {
  if (baseURL === undefined) throw new Error("no baseURL");

  await openBoard(page, BOARD, baseURL);
  const leaves = await leavesOf(page, screen(D0));
  const drawn = leaves.map((leaf) => leaf.text);
  // The expectations above are the board's own words; if a redraw moves
  // them, this says so before comparing the app with a stale list.
  for (const word of [...DRAWN_RAIL, ...DRAWN_STATS, "DESK"]) {
    expect(drawn, `D0 no longer draws "${word}"`).toContain(word);
  }
  expect(
    drawn.filter((text) => DRAWN_RAIL.includes(text)),
    "D0's rail order",
  ).toStrictEqual(DRAWN_RAIL);

  await signInAsOperator(page);
  await page.goto("/desk");
  await page
    .locator('html[data-hydrated="true"]')
    .waitFor({ state: "attached" });

  const rail = page.getByRole("navigation", { name: "Desk" });
  await expect(rail.getByText("Desk", { exact: true })).toBeVisible();
  const entries = await rail.getByRole("listitem").allTextContents();
  // A rail entry reads "Review4" when it carries a count, so each is
  // matched by the drawn label it starts with.
  const labels = entries.flatMap((entry) =>
    DRAWN_RAIL.filter((label) => entry.startsWith(label)),
  );
  expect(labels, "the app's rail, in D0's order").toStrictEqual(DRAWN_RAIL);

  const stats = page.getByRole("main").getByRole("listitem");
  await expect(stats).toHaveCount(3);
  // Singular and plural are the same line; the board draws "1 photo".
  const texts = await stats.allTextContents();
  const lines = texts.map((line) =>
    line.replace("photos the", "photo the").replace("ban this", "bans this"),
  );
  for (const [index, phrase] of DRAWN_STATS.entries()) {
    expect(lines[index], `Today's line ${String(index + 1)}`).toContain(
      phrase,
    );
  }
});
