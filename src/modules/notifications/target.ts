import { isoCalendarDay } from "../../lib/dates";
import type { ViewerZone } from "../../lib/dates";

/**
 * Where a bell row goes when it is pressed, from its kind and what it
 * links to. Pure, so the list renders a typed `Link` from it and a test
 * reads every kind's answer. A kind with nowhere to go is not a link.
 */
export type NotificationTarget =
  | { readonly to: "garment"; readonly itemId: string }
  | { readonly to: "profile"; readonly handle: string }
  | { readonly to: "own-profile" }
  | { readonly to: "upload"; readonly date: string };

export function notificationTarget(
  row: {
    readonly kind: string;
    readonly linkId: string | null;
    readonly linkHandle: string | null;
    readonly createdAt: number;
  },
  viewer: ViewerZone,
): NotificationTarget | undefined {
  switch (row.kind) {
    // The garment it was filed from (R48·129f).
    case "correction_applied":
    case "correction_declined": {
      return row.linkId === null
        ? undefined
        : { to: "garment", itemId: row.linkId };
    }
    // One follower: their profile. A group has no one follower, and opens
    // the runner's own profile, where the count is, until a followers list
    // exists (R48·131c; a design-ask).
    case "followed": {
      if (row.linkId === null) return { to: "own-profile" };
      return row.linkHandle === null
        ? undefined
        : { to: "profile", handle: row.linkHandle };
    }
    // A run landed on Strava: the upload, where its file goes, carrying the
    // day the notification arrived on in the runner's home zone (R55·183
    // (3)). Nothing from the activity is read (owner, 2026-11-13).
    case "strava_reminder": {
      return {
        to: "upload",
        date: isoCalendarDay(row.createdAt, viewer.homeZone),
      };
    }
  }
  return undefined;
}
