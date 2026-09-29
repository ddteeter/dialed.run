import type { JSX } from "react";

import { Mono } from "../../../ui";
import { removalSentence, type RemovalReason } from "../contracts";

/**
 * A notice where the thing was: a kicker naming the state that is true,
 * the sentence, and what stays (round 27 #20, #21). The §4a band's shape —
 * one ink rule, no hi-viz, because nothing here is the runner's to fix —
 * without its retry, because there is nothing to retry.
 */
export function NoticeBand({
  kicker,
  message,
  detail,
}: Readonly<{
  kicker: string;
  message: string;
  detail?: string | undefined;
}>): JSX.Element {
  return (
    <div
      data-part="notice-band"
      className="flex flex-col items-start gap-2 border border-ink p-4"
    >
      <Mono step="xs">{kicker}</Mono>
      <span className="text-body">{message}</span>
      {detail === undefined ? undefined : (
        <span className="text-small text-quiet">{detail}</span>
      )}
    </div>
  );
}

/**
 * D-69 (round 27 #21): a garment photo the classifier has not cleared yet,
 * on its owner's garment detail. Only they can see it until then.
 */
export function PhotoBeingChecked(): JSX.Element {
  return (
    <NoticeBand
      kicker="Being checked"
      message="Only you can see this photo until it's checked, usually within a day."
    />
  );
}

/**
The kicker for each kind of thing a moderator can remove (round 27 #20).
*/
const REMOVED_KICKER = {
  photo: "Photo removed",
  entry: "Removed from the feed",
} as const;

/**
 * Round 27 #20: where a removed photo was, or in place of a removed entry,
 * the band tells its author what came down and why — the statement of
 * reasons (SAF-8).
 */
export function ContentRemoved({
  subjectType,
  reason,
}: Readonly<{
  subjectType: keyof typeof REMOVED_KICKER;
  reason: RemovalReason;
}>): JSX.Element {
  return (
    <NoticeBand
      kicker={REMOVED_KICKER[subjectType]}
      message={removalSentence(subjectType, reason)}
      detail={
        subjectType === "photo" ? "Your run and verdict stay." : undefined
      }
    />
  );
}
