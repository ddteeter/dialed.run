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
  // Design 136 (D-117): placeholder words until design gives them (design
  // deltas item 58). The one reason that hides at once (`reportersToHide`).
  { value: "intimate", label: "It's an intimate image shared without consent" },
  { value: "harassment", label: "Harassment aimed at someone" },
  { value: "spam", label: "It's an ad, or it's spam" },
  { value: "not_theirs", label: "This isn't their run or their gear" },
  { value: "other", label: "Something else" },
] as const;

export type ReportReason = (typeof reportReasons)[number]["value"];

/**
 * The same table as a lookup, for the form primitives that want one.
 *
 * Derived rather than written out a second time — `ui/form`'s
 * `optionLabels` is exactly the shape a hand-maintained copy would drift
 * from, and `test/safety/contracts.test.ts` pins the derivation against
 * `reportReasons` in both directions.
 */
export const reportReasonLabels: Readonly<Record<ReportReason, string>> =
  Object.fromEntries(
    reportReasons.map((reason) => [reason.value, reason.label]),
  ) as Record<ReportReason, string>;

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
  {
    // The sentence a runner reads when they submit without choosing.
    // zod's default here is "Invalid option: expected one of
    // \"explicit\"|\"harassment\"…", which leaks the stored values into a
    // sheet whose whole point is that its words are the runner's, not the
    // system's. Error copy lives in the schema (CLAUDE.md forms contract),
    // so it lives here rather than in the component.
    message: "Pick what's wrong with it.",
  },
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
 * Distinct reporters a reason needs before the subject is hidden from
 * everyone (design 136, D-117). An intimate image shared without consent
 * is hidden on the first report: the TAKE IT DOWN Act gives 48 hours to
 * remove a valid one, and three reports would be three more people who saw
 * it. A person still decides, so a false report only hides a thing until
 * they do. Every other reason waits for `autoHideReporterThreshold`.
 */
export const reportersToHide: Readonly<Record<ReportReason, number>> = {
  explicit: autoHideReporterThreshold,
  intimate: 1,
  harassment: autoHideReporterThreshold,
  spam: autoHideReporterThreshold,
  not_theirs: autoHideReporterThreshold,
  other: autoHideReporterThreshold,
};

/**
The reasons that hide on the first report, read from the table above.
*/
export const reasonsThatHideAtOnce: readonly ReportReason[] = reportReasons
  .map((reason) => reason.value)
  .filter((reason) => reportersToHide[reason] === 1);

/**
 * How long the TAKE IT DOWN Act allows between a valid request and its
 * removal: the Review row's clock for a subject reported `intimate`.
 */
export const REMOVAL_DUE_SECONDS = 48 * 60 * 60;

/**
 * The Review row's clock (design 136): whole hours left, rounded up so the
 * last minutes still read "Due in 1h", then "Overdue". Placeholder words
 * (design deltas item 58).
 */
export function removalDueLabel(dueAt: number, now: number): string {
  const left = dueAt - now;
  return left > 0 ? `Due in ${String(Math.ceil(left / 3600))}h` : "Overdue";
}

/**
 * Why a moderator removed something, and the words the runner reads for
 * it — the statement of reasons the EU DSA asks for (task 128 · SAF-8,
 * decision D-40), after "A moderator removed this photo:" (round 27 #20,
 * whose one drawn example is `home`). A fixed list rather than free text,
 * so the runner is told a rule and not an operator's mood.
 */
export const removalStatements = {
  home: "it shows where someone lives",
  explicit: "it's sexual or explicit",
  // Design 136: placeholder words (design deltas item 58).
  intimate: "it's an intimate image shared without consent",
  harassment: "it harasses someone",
  spam: "it's an ad or spam",
  copyright: "it uses someone else's work",
  rules: "it breaks the community rules",
} as const;

export type RemovalReason = keyof typeof removalStatements;

/**
The reasons in the Desk's order, read from the table above.
*/
export const removalReasons = Object.keys(removalStatements) as [
  RemovalReason,
  ...RemovalReason[],
];

export const removalReasonSchema = z.enum(removalReasons, {
  message: "Pick why it's coming down.",
});

/**
 * What the author is told (round 27 #20): the same sentence in the bell
 * row, the band where the thing was, and — once 126's outbox lands — the
 * email.
 */
export function removalSentence(
  subjectType: "entry" | "photo",
  reason: RemovalReason,
): string {
  return `A moderator removed ${removedThing(subjectType)}: ${removalStatements[reason]}.`;
}

/**
 * What the author is told after a copyright takedown (round 28 #8): "We
 * removed this photo after a copyright notice." Not a moderator's reason
 * — the Desk acted on a notice, and the sentence says so. The board draws
 * the photo; an entry takes the same words with its own noun.
 */
export function takedownSentence(subjectType: "entry" | "photo"): string {
  return `We removed ${removedThing(subjectType)} after a copyright notice.`;
}

/**
The thing a removal sentence names, as its author knows it.
*/
function removedThing(subjectType: "entry" | "photo"): string {
  return subjectType === "photo" ? "this photo" : "this entry from the feed";
}

/**
 * Why a moderator took a runner's handle away (round 27 #16): the fixed
 * list D8's Rename control offers, quoted back on O0's "USERNAME CHANGED
 * BY A MODERATOR" field.
 */
export const renameReasons = [
  "Offensive or sexual",
  "Pretends to be someone else",
  "Contains personal information",
  "Advertising",
] as const;

export type RenameReason = (typeof renameReasons)[number];

export const renameReasonSchema = z.enum(renameReasons, {
  message: "Pick why the name has to go.",
});
