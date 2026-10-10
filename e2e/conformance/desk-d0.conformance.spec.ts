/**
 * D0, the Desk's shell and Today, against Operator Screens' "D0 Desk
 * shell" frame: the rail's destinations in order, and Today's three
 * numbers in the digest's order, each with the words the board gives it.
 *
 * The operator exists only with `ADMIN_USER_IDS=e2e-desk-operator` in the
 * dev server's `.dev.vars`, which CI's e2e job writes (R-72, PR #114).
 *
 * D-87's rail (round 30): Today, Review, Access, Duplicates, Runners, with
 * Gave up a section on Today rather than a rail item (R-127, closed by
 * design-adoption PR B). The board and the app are read against the same
 * list, so a rail either side moves fails here.
 *
 * What it does not compare, on purpose: the board's own values (4, 23, 3,
 * "OLDEST · 19H") are the drawing's data, not the app's — Today's rail
 * count among them, which is the Gave up count; "@mara ·
 * OPERATOR · SIGN OUT" is a design delta (no handle read before ACC-1, and
 * sign-out is 126's component); and "SCREENING · OK / LAST DIGEST" is
 * undrawn in words the build has anything behind yet.
 */
import { expect, test } from "@playwright/test";

import { leavesOf, openBoard, screen } from "../support/conformance";
import { signInAsOperator } from "../desk/operator";

const BOARD = "Operator Screens.dc.html";
const D0 = "D0 Desk shell";

/**
 * The rail as D0 draws it (D-87's order), and Today's three phrases in
 * its order.
 */
const DRAWN_RAIL = ["Today", "Review", "Access", "Duplicates", "Runners"];
const DRAWN_STATS = [
  "waiting for a decision",
  "photo the screener couldn't finish",
  "bans this week",
];
/**
 * Every label a rail has ever named, Gave up included: each side is read
 * against all of them, so a label that comes back shows up in its list.
 */
const RAIL_LABELS = [...DRAWN_RAIL, "Gave up"];

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
  // Gave up is a section on Today now (D-87), so D0's rail does not name
  // it; filtering by every known label catches it coming back.
  expect(drawn, `D0 draws "Gave up" again`).not.toContain("Gave up");
  expect(
    drawn.filter((text) => RAIL_LABELS.includes(text)),
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
  // matched by the label it starts with.
  const labels = entries.flatMap((entry) =>
    RAIL_LABELS.filter((label) => entry.startsWith(label)),
  );
  expect(labels, "the app's rail, as D0 draws it").toStrictEqual(DRAWN_RAIL);

  // Today's three numbers, in their own list: Gave up's rows sit under it.
  const stats = page
    .getByRole("main")
    .getByRole("list", { name: "Today" })
    .getByRole("listitem");
  await expect(stats).toHaveCount(3);
  // Singular and plural are the same line; the board draws "1 photo".
  const texts = await stats.allTextContents();
  const lines = texts.map((line) =>
    line.replace("photos the", "photo the").replace("ban this", "bans this"),
  );
  for (const [index, phrase] of DRAWN_STATS.entries()) {
    expect(lines[index], `Today's line ${String(index + 1)}`).toContain(phrase);
  }
});
