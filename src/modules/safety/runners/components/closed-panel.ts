import { DELETION_LINK_TTL_S } from "../../../../lib/contracts/garments";
import { monthDayLabel } from "../../../../lib/dates";
import type { DeskRunner } from "../runners";

/**
 * Where a closed account's deletion stands, for D8's closed panel (round
 * 64 #372–373), read from what the row holds:
 *
 * - `offer`: nothing sent, so Reopen and "Send deletion link";
 * - `sent`: a link is live, so Reopen only — one link at a time;
 * - `expired`: the link ran out unused, so Reopen and "Send again";
 * - `deleting`: the runner chose deletion, so no pills — Reopen can't
 *   undo it (owner, 2026-11-27);
 * - `age`: the Desk closed it for age, so Reopen only, which cancels the
 *   deletion too.
 */
export type ClosedPanel =
  | { readonly kind: "offer" }
  | { readonly kind: "sent"; readonly sentAt: number; readonly until: number }
  | { readonly kind: "expired"; readonly expiredAt: number }
  | {
      readonly kind: "deleting";
      readonly confirmedAt: number;
      readonly purgeAfter: number;
    }
  | {
      readonly kind: "age";
      readonly closedAt: number;
      readonly purgeAfter: number;
    };

/**
 * The panel's state at `now`, the page's load time. A deletion decides
 * it whatever the link says; a link that was used without one (the purge
 * took its deletion) offers a new one.
 */
export function closedPanelOf(
  runner: Pick<DeskRunner, "deletion" | "deletionLink">,
  now: number,
): ClosedPanel {
  const { deletion, deletionLink: link } = runner;
  if (deletion !== undefined) {
    // An age closure's deletion is written in the closure's own batch, so
    // its request is when the account was closed.
    return deletion.cause === "under_18"
      ? {
          kind: "age",
          closedAt: deletion.requestedAt,
          purgeAfter: deletion.purgeAfter,
        }
      : {
          kind: "deleting",
          confirmedAt: deletion.requestedAt,
          purgeAfter: deletion.purgeAfter,
        };
  }
  if (link === undefined || link.isUsed) return { kind: "offer" };
  return now < link.expiresAt
    ? {
        kind: "sent",
        sentAt: link.expiresAt - DELETION_LINK_TTL_S,
        until: link.expiresAt,
      }
    : { kind: "expired", expiredAt: link.expiresAt };
}

/**
 * The panel's status (round 64 #372–373): a MONO.sm bracket and a
 * TYPE.small line, or nothing while nothing is sent. Desk days are UTC.
 */
export interface ClosedStatus {
  readonly tag: string;
  readonly line: string | undefined;
}

export function closedStatusOf(panel: ClosedPanel): ClosedStatus | undefined {
  switch (panel.kind) {
    case "offer": {
      return undefined;
    }
    case "sent": {
      return {
        tag: `Sent ${monthDayLabel(panel.sentAt)}`,
        line: `The link works until ${monthDayLabel(panel.until)}. Reopening cancels it.`,
      };
    }
    case "expired": {
      return {
        tag: `Link expired ${monthDayLabel(panel.expiredAt)}`,
        line: undefined,
      };
    }
    case "deleting": {
      return {
        tag: `Deletes ${monthDayLabel(panel.purgeAfter)}`,
        line: `The runner confirmed on ${monthDayLabel(panel.confirmedAt)}.`,
      };
    }
    case "age": {
      return {
        tag: `Deletes ${monthDayLabel(panel.purgeAfter)}`,
        line: "Reopening before then also cancels the deletion.",
      };
    }
  }
}

/**
 * The line under the panel's heading: the operator's own reason, as
 * built, or — for an age closure (owner, 2026-11-27) — "Under 18" and the
 * day it was closed.
 */
export function closedLineOf(
  panel: ClosedPanel,
  banReason = "No reason recorded.",
): string {
  return panel.kind === "age"
    ? `Under 18 · closed ${monthDayLabel(panel.closedAt)}`
    : banReason;
}
