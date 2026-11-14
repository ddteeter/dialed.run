import { describe, expect, it } from "vitest";
import { z } from "zod";

import { notificationTarget } from "../../src/modules/notifications/target";

const NOTHING = z.null().parse(JSON.parse("null"));

// 03:30 UTC on Nov 13 is still Nov 12 in Chicago.
const LATE_CHICAGO = Math.floor(Date.UTC(2026, 10, 13, 3, 30) / 1000);
const OWED = { homeZone: undefined };
const CHICAGO = { homeZone: "America/Chicago" };

const row = (
  kind: string,
  linkId: string | null = NOTHING,
  linkHandle: string | null = NOTHING,
) => ({ kind, linkId, linkHandle, createdAt: LATE_CHICAGO });

describe("where a bell row goes", () => {
  it("opens the garment for a correction's outcome (R48·129f)", () => {
    for (const kind of ["correction_applied", "correction_declined"]) {
      expect(notificationTarget(row(kind, "01G"), OWED)).toStrictEqual({
        to: "garment",
        itemId: "01G",
      });
      expect(notificationTarget(row(kind), OWED)).toBeUndefined();
    }
  });

  it("opens one follower's profile by their handle now (R48·131c)", () => {
    expect(
      notificationTarget(row("followed", "01ADA", "ada"), OWED),
    ).toStrictEqual({
      to: "profile",
      handle: "ada",
    });
  });

  it("goes nowhere for a follower whose profile is gone", () => {
    expect(notificationTarget(row("followed", "01ADA"), OWED)).toBeUndefined();
  });

  it("opens the runner's own profile for a group", () => {
    expect(notificationTarget(row("followed"), OWED)).toStrictEqual({
      to: "own-profile",
    });
  });

  it("opens the upload on the day the reminder arrived, at home (R55·183)", () => {
    expect(
      notificationTarget(row("strava_reminder", "01S", "x"), CHICAGO),
    ).toStrictEqual({ to: "upload", date: "2026-11-12" });
    // No home zone yet: the day is UTC's, as the row's own time is.
    expect(notificationTarget(row("strava_reminder"), OWED)).toStrictEqual({
      to: "upload",
      date: "2026-11-13",
    });
  });

  it("goes nowhere for any other kind", () => {
    expect(
      notificationTarget(row("kit_reminder", "01R", "x"), OWED),
    ).toBeUndefined();
  });
});
