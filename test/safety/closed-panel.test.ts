import { describe, expect, it } from "vitest";

import { DELETION_LINK_TTL_S } from "../../src/lib/contracts/garments";
import {
  closedLineOf,
  closedPanelOf,
  closedStatusOf,
} from "../../src/modules/safety/runners/components/closed-panel";

/**
 * Where a closed account's deletion stands on D8 (round 64 #372–373),
 * read from the row: a deletion first, then the link, at the page's time.
 */

const NOW = Date.UTC(2026, 10, 27, 12) / 1000;
const DAY = 24 * 60 * 60;

describe("closedPanelOf", () => {
  it("offers a link while none was sent, or the one sent was used", () => {
    expect(
      closedPanelOf({ deletion: undefined, deletionLink: undefined }, NOW),
    ).toStrictEqual({ kind: "offer" });
    expect(
      closedPanelOf(
        {
          deletion: undefined,
          deletionLink: { expiresAt: NOW + DAY, isUsed: true },
        },
        NOW,
      ),
    ).toStrictEqual({ kind: "offer" });
  });

  it("is sent until the second the link runs out, and expired from it", () => {
    const expiresAt = NOW + DAY;
    const link = { expiresAt, isUsed: false };
    expect(
      closedPanelOf({ deletion: undefined, deletionLink: link }, expiresAt - 1),
    ).toStrictEqual({
      kind: "sent",
      sentAt: expiresAt - DELETION_LINK_TTL_S,
      until: expiresAt,
    });
    expect(
      closedPanelOf({ deletion: undefined, deletionLink: link }, expiresAt),
    ).toStrictEqual({ kind: "expired", expiredAt: expiresAt });
  });

  it("reads a deletion over any link: the runner's, or the Desk's for age", () => {
    const deletionLink = { expiresAt: NOW + DAY, isUsed: false };
    expect(
      closedPanelOf(
        {
          deletion: { requestedAt: NOW, purgeAfter: NOW + 7, cause: "asked" },
          deletionLink,
        },
        NOW,
      ),
    ).toStrictEqual({
      kind: "deleting",
      confirmedAt: NOW,
      purgeAfter: NOW + 7,
    });
    expect(
      closedPanelOf(
        {
          deletion: {
            requestedAt: NOW,
            purgeAfter: NOW + 7,
            cause: "under_18",
          },
          deletionLink,
        },
        NOW,
      ),
    ).toStrictEqual({ kind: "age", closedAt: NOW, purgeAfter: NOW + 7 });
  });
});

describe("closedStatusOf (round 64's words, Desk days in UTC)", () => {
  it("says nothing while nothing is sent", () => {
    expect(closedStatusOf({ kind: "offer" })).toBeUndefined();
  });

  it("says each state's bracket and line", () => {
    expect(
      closedStatusOf({ kind: "sent", sentAt: NOW, until: NOW + 7 * DAY }),
    ).toStrictEqual({
      tag: "Sent Nov 27",
      line: "The link works until Dec 4. Reopening cancels it.",
    });
    expect(
      closedStatusOf({ kind: "expired", expiredAt: NOW + 7 * DAY }),
    ).toStrictEqual({ tag: "Link expired Dec 4", line: undefined });
    expect(
      closedStatusOf({
        kind: "deleting",
        confirmedAt: NOW + DAY,
        purgeAfter: NOW + 8 * DAY,
      }),
    ).toStrictEqual({
      tag: "Deletes Dec 5",
      line: "The runner confirmed on Nov 28.",
    });
    expect(
      closedStatusOf({ kind: "age", closedAt: NOW, purgeAfter: NOW + 7 * DAY }),
    ).toStrictEqual({
      tag: "Deletes Dec 4",
      line: "Reopening before then also cancels the deletion.",
    });
  });
});

describe("closedLineOf", () => {
  it("says the operator's reason, or that none was recorded, or Under 18 for age", () => {
    expect(closedLineOf({ kind: "offer" }, "Spam")).toBe("Spam");
    expect(closedLineOf({ kind: "offer" })).toBe("No reason recorded.");
    expect(
      closedLineOf({ kind: "age", closedAt: NOW, purgeAfter: NOW }, "Says 15"),
    ).toBe("Under 18 · closed Nov 27");
  });
});
