/**
 * What a runner says is wrong, in the boards' words: one table per kind of
 * report sheet, and the values `reports.reason` may hold, derived from
 * both.
 *
 * In `lib/` rather than `modules/safety` because the schema reads it:
 * `src/db/` may import `src/lib/` and nothing else (R-77, #413), and a
 * hand-written enum on the column would be the rival copy CLAUDE.md
 * forbids. `modules/safety/contracts` re-exports it.
 *
 * **These sentences are the design's, not paraphrases of policy
 * categories.** W1's note is explicit: "Reasons are written as sentences a
 * runner would say, not policy categories." The keys are the stored
 * values and the sentences are the labels, which is why they are one
 * table and not two.
 */

/**
 * W1: what an entry, a photo or a product name can be reported for. These
 * are the reasons that can hide a subject, so the moderation thresholds'
 * config is keyed by exactly these (`modules/safety/thresholds`).
 */
export const reportReasons = [
  { value: "explicit", label: "The photo shows someone inappropriately" },
  // Design 136 (D-117), in round 35 #58a's words. The one reason on the
  // TAKE IT DOWN Act's clock (`reasonsOnTheClock`).
  {
    value: "intimate",
    label: "It's an intimate image of someone, shared without their consent",
  },
  { value: "harassment", label: "Harassment aimed at someone" },
  { value: "spam", label: "It's an ad, or it's spam" },
  { value: "not_theirs", label: "This isn't their run or their gear" },
  { value: "other", label: "Something else" },
] as const;

/**
 * R55·214: what a profile can be reported for, "profile reasons only".
 * Three share a stored value with W1's (harassment, spam, other), and two
 * are a profile's own (owner, 2026-11-13). A profile report never hides
 * anything (`hiddenByReport`), so none of these needs a threshold.
 */
export const profileReportReasons = [
  { value: "offensive", label: "Their name or photo is offensive" },
  { value: "harassment", label: "They're harassing someone" },
  {
    value: "impersonation",
    label: "They're pretending to be someone else",
  },
  { value: "spam", label: "It's an ad, or it's spam" },
  { value: "other", label: "Something else" },
] as const;

export type EntryReportReason = (typeof reportReasons)[number]["value"];
export type ProfileReportReason =
  (typeof profileReportReasons)[number]["value"];

/**
 * Anything `reports.reason` may hold: what either sheet can file.
 */
export type ReportReason = EntryReportReason | ProfileReportReason;

/**
 * The stored values, once each, in W1's order and then a profile's own:
 * the column's enum and the parser's.
 */
export const STORED_REPORT_REASONS = [
  ...new Set<ReportReason>(
    [...reportReasons, ...profileReportReasons].map((reason) => reason.value),
  ),
] as [ReportReason, ...ReportReason[]];
