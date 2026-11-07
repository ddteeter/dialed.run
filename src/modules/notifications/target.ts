/**
 * Where a bell row goes when it is pressed, from its kind and what it
 * links to. Pure, so the list renders a typed `Link` from it and a test
 * reads every kind's answer. A kind with nowhere to go is not a link.
 */
export type NotificationTarget =
  | { readonly to: "garment"; readonly itemId: string }
  | { readonly to: "profile"; readonly handle: string }
  | { readonly to: "own-profile" };

export function notificationTarget(row: {
  readonly kind: string;
  readonly linkId: string | null;
  readonly linkHandle: string | null;
}): NotificationTarget | undefined {
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
    default: {
      return undefined;
    }
  }
}
