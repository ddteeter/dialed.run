import { expect, test } from "@playwright/test";
import type { Page, Route } from "@playwright/test";

import { CARRIED_EMAIL_KEY } from "../../src/modules/auth/carried-email";
import { accountEmail } from "../support/accounts";
import { openBoard } from "../support/conformance";
import { fillOf, hydrated, partsExcept, partsIn, wordsOf } from "./auth-parts";

/**
 * Au1–Au7 and Au2 at 1040, built against `design/Auth.dc.html` (round 22).
 *
 * Region to region: which of the board's `data-part`s the page has, in
 * which order, and what each says. The board's fake values ("dana.k@…")
 * sit inside fields, which carry no part, so they never enter the diff.
 *
 * **Known gaps, asserted as gaps** so each fails loudly the day it closes
 * and the entry here is deleted rather than forgotten — the A3 spec's
 * mechanism:
 *
 * - `primary-action`: the board's primary is an ink pill; the build's is
 *   the shared `SubmitButton`, which is always pink and carries no
 *   `data-part`. Changing it is the coordinator's (task 120's primitives).
 * - The failure band: the board's has no button and relabels the primary
 *   "Try again"; the shared `FailureBand` always carries its own. Same.
 * - Au1's Name field stays until the username task (owner, 2026-09-24).
 * - "Forgot it?" is drawn on Au2–Au4 and Au7; there is no reset flow to
 *   send it to, so it is absent rather than a dead link.
 */

const BOARD = "Auth.dc.html";

/**
 * A frame by its exact label. `support/conformance`'s `screen` matches a
 * prefix, and "Au2 Log in" is a prefix of "Au2 Log in 1040".
 */
function screen(label: string): string {
  return `[data-screen-label="${label}"]`;
}

/**
 * The board's primary action, which the build cannot mark (see above).
 */
const UNMARKED = new Set(["primary-action"]);

async function boardParts(page: Page, label: string): Promise<string[]> {
  return partsExcept(page, screen(label), [...UNMARKED]);
}

/**
The panel's own regions — the app side of a phone frame.
*/
const PANEL = "main[data-part='panel']";

/**
 * The regions a phone frame names, with what each says on the board,
 * read before the app is opened in the same page.
 */
async function drawn(
  page: Page,
  baseURL: string,
  label: string,
  parts: readonly string[],
): Promise<{ order: string[]; words: Map<string, readonly string[]> }> {
  await openBoard(page, BOARD, baseURL);
  const order = await boardParts(page, label);
  expect(order, `the board has no ${label} frame`).not.toHaveLength(0);
  const words = new Map<string, readonly string[]>();
  for (const part of parts) {
    words.set(
      part,
      await wordsOf(page, `${screen(label)} [data-part='${part}']`),
    );
  }
  return { order, words };
}

async function builtAt390(page: Page, path: string): Promise<void> {
  await page.setViewportSize({ width: 390, height: 900 });
  await page.goto(path);
  await hydrated(page);
}

async function expectSameWords(
  page: Page,
  board: Map<string, readonly string[]>,
  appSelectors: Readonly<Record<string, string>>,
): Promise<void> {
  for (const [part, words] of board) {
    const selector = appSelectors[part] ?? `${PANEL} [data-part='${part}']`;
    expect([part, await wordsOf(page, selector)]).toEqual([part, words]);
  }
}

test.describe("Au · phone", () => {
  test("Au1 create account, at rest", async ({ page, baseURL }) => {
    if (baseURL === undefined) throw new Error("no baseURL");
    const board = await drawn(page, baseURL, "Au1 Create account", [
      "header",
      "or-divider",
      "google",
      "cross-link",
    ]);
    await builtAt390(page, "/auth/signup");

    expect(await partsIn(page, PANEL)).toEqual(board.order);
    await expectSameWords(page, board.words, {});
    // No tab bar and no product bar: "every tab is a signed-in place".
    await expect(page.locator("[data-slot='tab-bar']")).toHaveCount(0);
    // Known gap: the Name field, until the username task.
    await expect(page.getByLabel("Name")).toBeVisible();
  });

  test("Au2 log in, at rest", async ({ page, baseURL }) => {
    if (baseURL === undefined) throw new Error("no baseURL");
    const board = await drawn(page, baseURL, "Au2 Log in", [
      "header",
      "or-divider",
      "google",
      "cross-link",
    ]);
    await builtAt390(page, "/auth/login");

    expect(await partsIn(page, PANEL)).toEqual(board.order);
    await expectSameWords(page, board.words, {});
  });

  test("Au3 wrong password, on Password", async ({ page, baseURL }) => {
    if (baseURL === undefined) throw new Error("no baseURL");
    const board = await drawn(page, baseURL, "Au3 Wrong password", [
      "header",
      "field-message",
      "google",
    ]);
    await builtAt390(page, "/auth/login");
    await page.getByLabel("Email").fill(accountEmail("closet"));
    await page.getByLabel("Password").fill("not-the-password-at-all");
    await page.getByRole("button", { name: "Log in" }).click();
    await expect(page.locator("#password-message")).toBeVisible({
      timeout: 15_000,
    });

    // The field message is `FieldMessage`'s, marked by its id rather than
    // a part: it is the shared primitive's, and the id is its contract.
    expect(await partsIn(page, PANEL)).toEqual(
      board.order.filter((part) => part !== "field-message"),
    );
    await expectSameWords(page, board.words, {
      "field-message": "#password-message",
    });
    await expect(page.locator(`${PANEL} [data-part='form']`)).toHaveAttribute(
      "data-state",
      "field-failure",
    );
  });

  test("Au4 server fault, as the band above the primary", async ({
    page,
    baseURL,
  }) => {
    if (baseURL === undefined) throw new Error("no baseURL");
    const board = await drawn(page, baseURL, "Au4 Server fault", [
      "header",
      "failure-band",
      "google",
    ]);
    await builtAt390(page, "/auth/login");
    await page.route("**/api/auth/sign-in/email", (route) =>
      route.fulfill({ status: 500, body: "{}" }),
    );
    await page.getByLabel("Email").fill(accountEmail("closet"));
    await page.getByLabel("Password").fill("any-password-at-all");
    await page.getByRole("button", { name: "Log in" }).click();
    const band = page.locator(`${PANEL} [data-part='failure-band']`);
    await expect(band).toBeVisible({ timeout: 15_000 });

    expect(await partsExcept(page, PANEL, ["cross-link"])).toEqual(board.order);
    // Known gap: the shared band carries its own Try again.
    expect(await wordsOf(page, `${PANEL} [data-part='failure-band']`)).toEqual([
      ...(board.words.get("failure-band") ?? []),
      "TRY AGAIN",
    ]);
    board.words.delete("failure-band");
    await expectSameWords(page, board.words, {});
  });

  test("Au5 Google in flight", async ({ page, baseURL }) => {
    if (baseURL === undefined) throw new Error("no baseURL");
    const board = await drawn(page, baseURL, "Au5 Google in flight", [
      "google",
    ]);
    await builtAt390(page, "/auth/login");
    // Held open, so the in-flight state is what is on screen.
    const held: Route[] = [];
    await page.route("**/api/auth/sign-in/social", (route) => {
      held.push(route);
    });
    await page.getByRole("button", { name: "Continue with Google" }).click();
    const google = page.locator(`${PANEL} [data-part='google']`);
    await expect(google).toHaveAttribute("data-state", "pending");
    expect(held).toHaveLength(1);

    await expectSameWords(page, board.words, {});
  });

  test("Au6 Google failed, the band above Google", async ({
    page,
    baseURL,
  }) => {
    if (baseURL === undefined) throw new Error("no baseURL");
    const board = await drawn(page, baseURL, "Au6 Google error", [
      "failure-band",
    ]);
    await builtAt390(page, "/auth/login");
    await page.route("**/api/auth/sign-in/social", (route) =>
      route.fulfill({ status: 502, body: "{}" }),
    );
    await page.getByRole("button", { name: "Continue with Google" }).click();
    await expect(
      page.locator(`${PANEL} [data-part='failure-band']`),
    ).toBeVisible({ timeout: 15_000 });

    // The band sits between the divider and Google, as drawn.
    // Au6 draws no cross-link beneath; the build keeps Au2's.
    expect(await partsExcept(page, PANEL, ["cross-link"])).toEqual(board.order);
    // Known gap: the shared band carries its own Try again, and the Google
    // button keeps its rest label rather than "Try Google again".
    expect(await wordsOf(page, `${PANEL} [data-part='failure-band']`)).toEqual([
      ...(board.words.get("failure-band") ?? []),
      "TRY AGAIN",
    ]);
  });

  test("Au7 signed out arrival", async ({ page, baseURL }) => {
    if (baseURL === undefined) throw new Error("no baseURL");
    const board = await drawn(page, baseURL, "Au7 Signed out arrival", [
      "header",
      "session-notice",
      "google",
    ]);
    const notice = await fillOf(
      page,
      `${screen("Au7 Signed out arrival")} [data-part='session-notice']`,
    );
    const email = accountEmail("closet");
    // The email rides in session storage, never the URL.
    await page.addInitScript(
      ([key, value]) => {
        sessionStorage.setItem(key, value);
      },
      [CARRIED_EMAIL_KEY, email] as const,
    );
    await builtAt390(page, "/auth/login?carried=run&redirect=%2Fruns%2Fnew");
    expect(page.url()).not.toContain("email");

    expect(await partsIn(page, PANEL)).toEqual(board.order);
    await expectSameWords(page, board.words, {});
    expect(await fillOf(page, `${PANEL} [data-part='session-notice']`)).toBe(
      notice,
    );
    await expect(page.getByLabel("Email")).toHaveValue(email);
    await expect(page.getByLabel("Password")).toBeFocused();
  });
});

test("Au2 at 1040: the landing bar with no action, the panel beneath", async ({
  page,
  baseURL,
}) => {
  if (baseURL === undefined) throw new Error("no baseURL");
  const label = "Au2 Log in 1040";
  await openBoard(page, BOARD, baseURL);
  const order = await boardParts(page, label);
  const bar = await wordsOf(page, `${screen(label)} [data-part='top-bar']`);

  await page.setViewportSize({ width: 1040, height: 900 });
  await page.goto("/auth/login");
  await hydrated(page);

  // The bar and the panel, in that order; the panel's own wordmark is
  // gone ("so there is one"), and no action sits in the bar.
  const built = await partsIn(page, "body");
  expect(built.slice(0, 3)).toEqual(order.slice(0, 3));
  expect(built.filter((part) => part === "wordmark")).toHaveLength(1);
  expect(built).not.toContain("bar-actions");
  expect(await wordsOf(page, "[data-part='top-bar']")).toEqual(bar);
  await expect(page.locator("[data-slot='tab-bar']")).toBeHidden();
});
