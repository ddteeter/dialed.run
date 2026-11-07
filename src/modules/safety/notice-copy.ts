/**
 * The words of the notices a report's life owes (C8; D-132, D-145), and
 * those an automatic hold owes (D-162), apart
 * from `notices.ts`, which writes them: that file reaches D1, and these
 * are read by a component test too.
 */
import { APPEAL_ADDRESS } from "../../lib/contracts/contact";

/**
The two subjects that have an author to tell.
*/
export type Authored = "entry" | "photo";

/**
 * What the author is told when a report hides their thing (owner,
 * 2026-10-22, for a photo; the kit's words follow it). The heading and its
 * sentences are one bell row, so the heading ends with a full stop.
 */
export const HIDDEN_NOTICE: Readonly<Record<Authored, string>> = {
  photo:
    "Photo hidden while we review it. Someone reported a photo on your run, so other runners can't see it until a person reviews it, usually within a day. It was hidden automatically. We'll tell you what we decide.",
  entry:
    "Kit hidden while we review it. Someone reported a kit you shared, so other runners can't see it until a person reviews it, usually within a day. It was hidden automatically. We'll tell you what we decide.",
};

/**
 * What the author is told when a person leaves it up: the hide notice's
 * "We'll tell you what we decide", kept.
 */
export const KEPT_NOTICE: Readonly<Record<Authored, string>> = {
  photo: "We reviewed the reported photo on your run and left it up.",
  entry: "We reviewed your reported kit and left it up.",
};

/**
 * What the author is told when automatic screening holds a kit photo for
 * review (D-162; owner, 2026-11-06): the classifier, or a match to an
 * image removed as intimate (D-147). One bell row, as a report's hide is,
 * with the same promise. Only a photo: screening holds nothing else.
 */
export const SCREENING_HIDDEN_NOTICE =
  "Photo hidden while we review it. Our automatic screening flagged a photo on your run, so other runners can't see it until a person reviews it, usually within a day. We'll tell you what we decide.";

/**
 * What the author is told when a person leaves a held photo up: the
 * screening notice's "We'll tell you what we decide", kept (owner,
 * 2026-11-06).
 */
export const SCREENING_KEPT_NOTICE =
  "We reviewed the flagged photo on your run and left it up.";

/**
What a reporter is told, per outcome (owner, 2026-10-22).
*/
export const REPORT_OUTCOME = {
  removed: "We removed what you reported.",
  kept: `We reviewed what you reported and left it up. We didn't find that it breaks our community rules. Disagree? Write to ${APPEAL_ADDRESS}.`,
} as const;

export type ReportOutcome = keyof typeof REPORT_OUTCOME;
