/**
 * The vocabulary of task 106, in `lib`-shaped form: values both a component
 * and a server function need, declared once so neither owns them.
 *
 * It lives in the module rather than `lib/` because nothing outside safety
 * reads it; if a second module ever needs these, they move up rather than
 * getting copied (CLAUDE.md "derive, don't mirror").
 */
import { z } from "zod";

/**
 * What a runner says is wrong, in the artboard's words.
 *
 * **These sentences are the design's, not paraphrases of policy
 * categories.** W1's note is explicit: "Reasons are written as sentences a
 * runner would say, not policy categories." Rewording them into
 * `sexual_content` / `harassment` / `spam` would be inventing design
 * language on a surface that has one.
 *
 * The keys are the stored values and the sentences are the labels, which is
 * why they are one table and not two: a hand-written second copy in the
 * component is exactly the rival truth CLAUDE.md warns about.
 */
export const reportReasons = [
  { value: "explicit", label: "The photo shows someone inappropriately" },
  { value: "harassment", label: "Harassment aimed at someone" },
  { value: "spam", label: "It's an ad, or it's spam" },
  { value: "not_theirs", label: "This isn't their run or their gear" },
  { value: "other", label: "Something else" },
] as const;

export type ReportReason = (typeof reportReasons)[number]["value"];

/**
 * Derived from the table above rather than restated, so a reason added to
 * one is a reason in the other. `test/safety/contracts.test.ts` pins the
 * derivation against `reportReasons` in both directions.
 */
export const reportReasonSchema = z.enum(
  reportReasons.map((reason) => reason.value) as [
    ReportReason,
    ...ReportReason[],
  ],
);

/**
 * What can be reported. Product names are here because D-26 makes them UGC:
 * a shared canonical row whose name a stranger typed is as reportable as a
 * photo.
 */
export const reportSubjectTypes = [
  "entry",
  "photo",
  "profile",
  "product",
] as const;
export type ReportSubjectType = (typeof reportSubjectTypes)[number];
export const reportSubjectTypeSchema = z.enum(reportSubjectTypes);

/**
 * Distinct reporters required before a subject is hidden globally pending
 * review (packet §2: "N reports from distinct users (default 3)").
 *
 * Named rather than inlined because two places need to agree on it — the
 * threshold check and the test that proves three distinct reporters trip it
 * where three reports from one person do not.
 */
export const autoHideReporterThreshold = 3;

/**
 * The label a subject carries while it waits for a person. The owner sees
 * this on their own entry; nobody else sees the entry at all.
 */
export const underReviewLabel = "Under review";
