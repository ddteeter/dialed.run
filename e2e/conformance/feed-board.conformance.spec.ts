import { expect, test } from "@playwright/test";

import { nowSeconds } from "../../src/lib/now";
import { storageStateFor } from "../support/accounts";
import { PHONE } from "../support/bars";
import { hydrated, openBoard, part } from "../support/conformance";
import {
  feedUserId,
  partsIn,
  removeSeeded,
  seedEntry,
  seeded,
} from "./feed-support";

/**
 * The Feed board (round 29's `Feed.dc.html`), which is now E1's
 * composition truth: the author's own entry under review, as the card
 * draws it ("E1 Card states") and as D carries it.
 *
 * **Round 29 #4 (D-90):** the card's tag is `[UNDER REVIEW]` in the
 * author row, before the badge, where SHARED would sit — compared by
 * composition and by its words. D carries round 28 #6's band at the top
 * instead, which the board's D frames draw only as text, so its words are
 * the ruling's.
 */
test.use({ storageState: storageStateFor("feed") });

const BOARD = "Feed.dc.html";
const CARD_STATES = "E1 Card states light";

function builtPost(entryId: string): string {
  return `[data-part="post"]:has(a[href="/feed/entry/${entryId}"])`;
}

test("the author's own entry under review: the tag in the author row on the card, the band on D", async ({
  page,
  baseURL,
}) => {
  if (baseURL === undefined) throw new Error("no baseURL");

  // ---- What the board draws ------------------------------------------
  await openBoard(page, BOARD, baseURL);
  const drawnPost = `${part(CARD_STATES, "post")}[data-state="own-under-review"]`;
  const drawn = {
    parts: await partsIn(page, drawnPost),
    tag: await page
      .locator(`${drawnPost} [data-part="review-tag"]`)
      .innerText(),
  };
  expect(drawn.parts, "the board has no own under-review post").toContain(
    "review-tag",
  );

  // ---- What we built --------------------------------------------------
  const rows = seeded();
  const { entryId } = await seedEntry(rows, {
    userId: await feedUserId(),
    place: { lat: 61.4, lng: 12.41 },
    startedAt: nowSeconds() - 3600,
    verdict: 0,
    moderationStatus: "hidden_pending_review",
  });

  try {
    await page.setViewportSize(PHONE);
    await page.goto("/feed");
    await hydrated(page);
    // Following, where the author's own shared entries sit among the rest.
    await page.getByRole("button", { name: "Following" }).click();
    const post = page.locator(builtPost(entryId));
    await expect(post).toBeVisible();

    expect(await partsIn(page, builtPost(entryId))).toEqual(drawn.parts);
    // Its visible words are the board's; what is said aloud is the
    // ruling's sentence.
    expect(
      await post
        .locator('[data-part="review-tag"] [aria-hidden="true"]')
        .innerText(),
    ).toBe(drawn.tag);
    await expect(post.getByRole("link")).toHaveAccessibleName(
      /Under review, only you can see this/u,
    );
    await expect(post.getByText(/· You$/u)).toBeVisible();

    await page.goto(`/feed/entry/${entryId}`);
    await hydrated(page);
    const band = page.locator('[data-part="notice-band"]');
    await expect(band).toContainText(
      "Only you can see this while we look at it.",
    );
    await expect(band).toContainText("You can still edit or delete it.");
    expect(await band.locator("span").first().innerText()).toBe(
      "HIDDEN WHILE WE CHECK",
    );
    await expect(page.locator('[data-part="review-tag"]')).toHaveCount(0);
  } finally {
    await removeSeeded(rows);
  }
});
