import { describe, expect, it } from "vitest";

import { isEntryPubliclyVisible } from "../../src/modules/safety";

/**
 * The one predicate every public read of an entry goes through.
 *
 * Both halves matter and they fail in opposite directions: forgetting the
 * sharing flag publishes a private entry, and forgetting the moderation
 * status publishes one three people reported.
 */
describe("whether an entry is publicly visible", () => {
  it("shows a public entry nobody has reported", () => {
    expect(
      isEntryPubliclyVisible({ isPublic: true, moderationStatus: "ok" }),
    ).toBe(true);
  });

  it("hides a private entry, however clean its moderation status", () => {
    // The runner's own sharing choice is not the moderation decision, and
    // a check that read only the status would publish every private
    // entry in the app.
    expect(
      isEntryPubliclyVisible({ isPublic: false, moderationStatus: "ok" }),
    ).toBe(false);
  });

  it.each(["hidden_pending_review", "removed"])(
    "hides a public entry whose moderation status is %s",
    (moderationStatus) => {
      expect(isEntryPubliclyVisible({ isPublic: true, moderationStatus })).toBe(
        false,
      );
    },
  );
});
