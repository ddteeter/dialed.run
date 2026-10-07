import type { JSX } from "react";

import { Bracketed } from "../../../ui";

/**
 * What a screen reader hears for the tag (round 29 #4): the board's own
 * sentence, since the brackets alone say nothing about who can see it.
 */
export const UNDER_REVIEW_NAME = "Under review, only you can see this";

/**
 * The author's own entry that reports have hidden pending review (R-62,
 * D-67), as the card marks it: `[UNDER REVIEW]` in MONO.xs ink with no
 * fill, in the author row where SHARED would sit, before the badge (round
 * 29 #4, the Feed board's "E1 Card states"). Only the author is ever
 * shown one, because nobody else can reach the entry.
 *
 * **Bracketed, and still** (D-90): the brackets are D-67's wording and
 * stay, but they do not breathe. Only a pending press breathes, and this
 * is ink, not pink, so it does not read as one. D carries the band
 * instead (`HIDDEN_WHILE_WE_CHECK`), never this tag.
 *
 * The visible brackets are hidden from assistive tech and the sentence is
 * said instead, so the card's link reads "…, Under review, only you can
 * see this" rather than "left bracket under review right bracket".
 */
export function UnderReview(): JSX.Element {
  return (
    <span data-part="review-tag" className="whitespace-nowrap text-ink">
      <span aria-hidden="true">
        <Bracketed step="xs">Under review</Bracketed>
      </span>
      <span className="sr-only">{UNDER_REVIEW_NAME}</span>
    </span>
  );
}

/**
 * D's band for the same state (round 28 #6, unchanged by round 29 #4
 * apart from its kicker losing the fill): at the top of the author's own
 * entry, with no retry because there is nothing to retry. It never says
 * who reported it, why, or how long it takes.
 */
export const HIDDEN_WHILE_WE_CHECK = {
  kicker: "Hidden while we check",
  message: "Only you can see this while we look at it.",
  detail: "You can still edit or delete it.",
} as const;
