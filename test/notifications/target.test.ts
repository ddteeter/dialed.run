import { describe, expect, it } from "vitest";
import { z } from "zod";

import { notificationTarget } from "../../src/modules/notifications/target";

const NOTHING = z.null().parse(JSON.parse("null"));

const row = (
  kind: string,
  linkId: string | null = NOTHING,
  linkHandle: string | null = NOTHING,
) => ({ kind, linkId, linkHandle });

describe("where a bell row goes", () => {
  it("opens the garment for a correction's outcome (R48·129f)", () => {
    for (const kind of ["correction_applied", "correction_declined"]) {
      expect(notificationTarget(row(kind, "01G"))).toStrictEqual({
        to: "garment",
        itemId: "01G",
      });
      expect(notificationTarget(row(kind))).toBeUndefined();
    }
  });

  it("opens one follower's profile by their handle now (R48·131c)", () => {
    expect(notificationTarget(row("followed", "01ADA", "ada"))).toStrictEqual({
      to: "profile",
      handle: "ada",
    });
  });

  it("goes nowhere for a follower whose profile is gone", () => {
    expect(notificationTarget(row("followed", "01ADA"))).toBeUndefined();
  });

  it("opens the runner's own profile for a group", () => {
    expect(notificationTarget(row("followed"))).toStrictEqual({
      to: "own-profile",
    });
  });

  it("goes nowhere for any other kind", () => {
    expect(notificationTarget(row("kit_reminder", "01R", "x"))).toBeUndefined();
  });
});
