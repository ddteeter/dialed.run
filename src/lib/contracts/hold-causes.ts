/**
 * Why a row is in Review, as `review_queue.source` stores them, and the
 * three automated holds the breakers bound (design 164). Here rather than
 * in the schema, because the Desk releases a burst of one cause's holds
 * and a component may not import server-only code.
 *
 * - `reports` — enough people reported it, or one reported an intimate
 *   image (design 136).
 * - `classifier` — the screener flagged it, or put it in the middle band.
 * - `fingerprint` — an upload matched an image removed as intimate
 *   (D-147, design 152).
 */
export const HOLD_CAUSES = ["reports", "classifier", "fingerprint"] as const;

export type HoldCause = (typeof HOLD_CAUSES)[number];

/**
 * Every source a Review row can have: the holds, and a photo still pending
 * screening a day after upload (D-157, design 167), whether the classifier
 * never answered (`unscreened`) or storage has no object (`missing_file`).
 * Those two are not hold causes: no breaker counts them and no burst
 * release approves them.
 */
export const REVIEW_SOURCES = [
  ...HOLD_CAUSES,
  "unscreened",
  "missing_file",
] as const;
