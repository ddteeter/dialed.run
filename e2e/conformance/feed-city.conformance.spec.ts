import { expect, test } from "@playwright/test";
import type { Page } from "@playwright/test";

import { storageStateFor } from "../support/accounts";
import { PHONE } from "../support/bars";
import { hydrated, openBoard, screen } from "../support/conformance";
import {
  answerFind,
  feedUserId,
  forgetPlace,
  unfollowEveryone,
} from "./feed-support";

/**
 * The typed city (round 26 #12): "City field empty", "City field
 * resolved" and "City field not found", held against Your conditions'
 * location-denied state, which is where a runner meets the field.
 *
 * Compared as the set of lines each side reads, not their order. The
 * board draws the hint between the label and the input; the shared
 * `TextField` puts every hint under its field, and `ui/` is not this
 * lane's to change — so the order is a recorded design delta, and what is
 * held here is that every drawn word is built and nothing else is. The
 * value typed is data, not copy, and is left out on both sides.
 */
test.use({
  storageState: storageStateFor("feed"),
  permissions: [],
});

const BOARD = "Round 26 Rulings.dc.html";

async function linesOf(page: Page, selector: string): Promise<string[]> {
  const text = await page.locator(selector).first().innerText();
  return text
    .split("\n")
    .map((line) => line.trim().toUpperCase())
    .filter((line) => line !== "");
}

async function drawn(
  page: Page,
  baseURL: string,
  label: string,
  typed: string,
): Promise<string[]> {
  await openBoard(page, BOARD, baseURL);
  const lines = await linesOf(page, screen(label));
  return lines.filter((line) => line !== typed.toUpperCase()).toSorted((a, b) => a.localeCompare(b));
}

async function openDenied(page: Page): Promise<void> {
  const userId = await feedUserId();
  await unfollowEveryone(userId);
  await forgetPlace(userId);
  await page.context().clearPermissions();
  await page.setViewportSize(PHONE);
  await page.goto("/feed");
  await hydrated(page);
  await expect(page.getByText("Where do you run?")).toBeVisible();
}

async function built(page: Page): Promise<string[]> {
  const lines = await linesOf(page, '[data-part="city-finder"]');
  return lines.toSorted((a, b) => a.localeCompare(b));
}

test("City field empty: the label, round 26's hint, and Find", async ({
  page,
  baseURL,
}) => {
  if (baseURL === undefined) throw new Error("no baseURL");
  // The board's value is a placeholder a runner never sees typed.
  const board = await drawn(
    page,
    baseURL,
    "City field empty",
    "City and state, e.g. Portland, OR",
  );

  await openDenied(page);

  expect(await built(page)).toEqual(board);
});

test("City field resolved: Weather for the place, Use this, and the way out", async ({
  page,
  baseURL,
}) => {
  if (baseURL === undefined) throw new Error("no baseURL");
  const board = await drawn(page, baseURL, "City field resolved", "Portland");

  await openDenied(page);
  await answerFind(page, {
    kind: "found",
    address: "Portland, OR, United States",
    lat: 45.52,
    lng: -122.68,
  });
  await page.getByLabel("Your city").fill("Portland");
  await page.getByRole("button", { name: "Find" }).click();
  await expect(page.getByRole("button", { name: "Use this" })).toBeVisible();

  // "Weather for" and the place are one line in both: the place is bold
  // inside the sentence.
  expect(await built(page)).toEqual(board);
});

test("City field not found: the field message, quoting what was typed", async ({
  page,
  baseURL,
}) => {
  if (baseURL === undefined) throw new Error("no baseURL");
  const board = await drawn(
    page,
    baseURL,
    "City field not found",
    "Portlnd, OR",
  );

  await openDenied(page);
  await answerFind(page, { kind: "not-found" });
  await page.getByLabel("Your city").fill("Portlnd, OR");
  await page.getByRole("button", { name: "Find" }).click();
  await expect(page.locator("#cityLabel-message")).toBeVisible();

  // The hint steps aside for the message, which the board does not do: a
  // field shows one sentence under it, never two (Form Contract).
  const drawnWithoutHint = board.filter(
    (line) => !line.startsWith("ADD THE STATE OR COUNTRY"),
  );
  expect(await built(page)).toEqual(drawnWithoutHint);
});

test("A failed lookup is the NOT FOUND YET band, not a field message", async ({
  page,
}) => {
  await openDenied(page);
  await answerFind(page, { kind: "unavailable" });
  await page.getByLabel("Your city").fill("Portland");
  await page.getByRole("button", { name: "Find" }).click();

  const band = page.locator('[data-part="failure-band"]');
  await expect(band).toContainText("Not found yet", { ignoreCase: true });
  await expect(band).toContainText("Couldn't look that up.");
  await expect(page.getByLabel("Your city")).not.toHaveAttribute(
    "aria-invalid",
  );
});
