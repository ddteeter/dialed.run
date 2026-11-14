/**
 * The vocabulary of task 106, in `lib`-shaped form: values both a component
 * and a server function need, declared once so neither owns them.
 *
 * It lives in the module rather than `lib/` because nothing outside safety
 * reads it; if a second module ever needs these, they move up rather than
 * getting copied (CLAUDE.md "derive, don't mirror").
 */
import { z } from "zod";

import {
  profileReportReasons,
  reportReasons,
  STORED_REPORT_REASONS,
  type EntryReportReason,
  type ProfileReportReason,
  type ReportReason,
} from "../../lib/contracts/report-reasons";

import {
  communityRuleKeys,
  communityRules,
  ruleLine,
  type CommunityRule,
} from "../../lib/contracts/community-rules";
import {
  COPYRIGHT_NOTICE_CLAUSE,
  GARMENT_PHOTO_REMOVED,
} from "../../lib/contracts/email-kinds";

/**
 * The report reasons live in `lib/contracts/report-reasons` because the
 * schema's `reports.reason` column reads them; they are re-exported here
 * for the module's own readers.
 */
export {
  profileReportReasons,
  reportReasons,
  STORED_REPORT_REASONS,
  type EntryReportReason,
  type ProfileReportReason,
  type ReportReason,
} from "../../lib/contracts/report-reasons";

/**
 * Every stored reason in words, for the Desk (the review queue and Who
 * reported). A value both sheets share reads as W1 says it; a profile's
 * own reads as R55·214 does. Derived from the two tables, never retyped;
 * `test/safety/contracts.test.ts` pins it in both directions.
 */
export const reportReasonLabels: Readonly<Record<ReportReason, string>> =
  Object.fromEntries(
    [...profileReportReasons, ...reportReasons].map((reason) => [
      reason.value,
      reason.label,
    ]),
  ) as Record<ReportReason, string>;

/**
 * A profile sheet's labels, in R55·214's words.
 */
export const profileReportReasonLabels: Readonly<
  Record<ProfileReportReason, string>
> = Object.fromEntries(
  profileReportReasons.map((reason) => [reason.value, reason.label]),
) as Record<ProfileReportReason, string>;

// The sentence a runner reads when they submit without choosing. zod's
// default here is "Invalid option: expected one of \"explicit\"|…",
// which leaks the stored values into a sheet whose whole point is that
// its words are the runner's, not the system's. Error copy lives in the
// schema (CLAUDE.md forms contract), so it lives here rather than in the
// component.
const PICK_ONE = { message: "Pick what's wrong with it." };

/**
 * Anything `reports.reason` may hold: what the Desk reads back. Derived
 * from the two tables, as the column is.
 */
export const reportReasonSchema = z.enum(STORED_REPORT_REASONS, PICK_ONE);

/**
 * What W1 may file against an entry, a photo or a product: the reasons
 * that can hide a subject, and the moderation config's keys.
 */
export const entryReportReasonSchema = z.enum(
  reportReasons.map((reason) => reason.value) as [
    EntryReportReason,
    ...EntryReportReason[],
  ],
  PICK_ONE,
);

/**
 * What R55·214's sheet may file against a profile.
 */
export const profileReportReasonSchema = z.enum(
  profileReportReasons.map((reason) => reason.value) as [
    ProfileReportReason,
    ...ProfileReportReason[],
  ],
  PICK_ONE,
);

/**
 * Whether a stored reason is one W1 files, the ones with a threshold.
 */
export function isEntryReportReason(
  reason: ReportReason,
): reason is EntryReportReason {
  return entryReportReasonSchema.safeParse(reason).success;
}

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
 * What a report can hide, per subject type, and what a removal alert names
 * it as: an entry or a photo. A profile or a product queues for a person
 * without hiding anything — a profile is a ban decision, and hiding a
 * shared product would take every garment linked to it down too.
 */
export const hiddenByReport: Readonly<
  Record<ReportSubjectType, "entry" | "photo" | undefined>
> = {
  entry: "entry",
  photo: "photo",
  profile: undefined,
  product: undefined,
};

/**
 * The subject types a report can hide, read from `hiddenByReport`: what
 * the report breaker counts (design 164; owner, 2026-10-31), so a flood of
 * profile or product reports cannot pause the hides it bounds.
 */
export const reportSubjectsThatHide: readonly ReportSubjectType[] =
  reportSubjectTypes.filter((type) => hiddenByReport[type] !== undefined);

/**
 * The reasons on the TAKE IT DOWN Act's 48-hour clock (design 136,
 * D-117): a report of one starts the clock, alerts the operators, and
 * sets a review row's due time. A statute's line, not a tunable count, so
 * it lives here rather than with the thresholds (`./thresholds`), which
 * say how many reporters any reason needs before a subject is hidden.
 */
export const reasonsOnTheClock: readonly ReportReason[] = ["intimate"];

/**
 * What "intimate" means on the Desk (D-161 2; owner, 2026-11-06): the
 * TAKE IT DOWN Act's line, 15 U.S.C. § 6851(a)(5). Said to the operator
 * on every row an intimate-image report or a `/takedown` request opened,
 * so a photo outside it is declined, or removed under the rule it does
 * break (a courtesy removal names `othersPhotos`). Runner-facing words
 * keep "intimate".
 */
export const STATUTORY_LINE =
  "Intimate means nudity or sexual content (15 U.S.C. § 6851). If it isn't, decline, and remove it under another rule if it breaks one.";

/**
 * How long the TAKE IT DOWN Act allows between a valid request and its
 * removal: the Review row's clock for a subject reported `intimate`.
 */
export const REMOVAL_DUE_SECONDS = 48 * 60 * 60;

/**
 * Why an operator declined a removal request (design 136): sent to the
 * person who asked. One field for the form and the server input.
 */
export const declineReasonField = z
  .string()
  .trim()
  .min(1, "Say why, for the person who asked.")
  .max(500, "Keep it under 500 characters.");

/**
 * The Review row's clock (design 136): whole hours left, rounded up so the
 * last minutes still read "Due in 1h", then "Overdue" — DUE IN 31H and
 * OVERDUE in the row's header, uppercase in CSS (round 35 #58b).
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
 * so the runner is told a rule and not an operator's mood. Every reason
 * names one of the terms' rules (`removalRule`): the Desk's catch-all
 * `rules` was retired (owner, 2026-10-24) because a statement of reasons
 * must name the ground it rests on (DSA Art. 17(3)(e)).
 */
export const removalStatements = {
  home: "it shows where someone lives",
  explicit: "it's sexual or explicit",
  // Design 136; confirmed by round 35 #58c.
  intimate: "it's an intimate image shared without consent",
  harassment: "it harasses someone",
  // A courtesy removal (D-161; owner, 2026-11-06): a photo of someone who
  // did not agree to it, and is not intimate under the statutory line.
  othersPhotos: "it shows someone who didn't agree to it",
  spam: "it's an ad or spam",
  copyright: "it uses someone else's work",
} as const;

export type RemovalReason = keyof typeof removalStatements;

/**
 * The terms' rule each removal reason breaks, for the statement of reasons
 * (C8, D-145). An intimate image shared without consent is sexual
 * content. Every reason names one, so the type admits no gap.
 */
export const removalRule: Readonly<Record<RemovalReason, CommunityRule>> = {
  home: "home",
  explicit: "explicit",
  intimate: "explicit",
  harassment: "harassment",
  othersPhotos: "othersPhotos",
  spam: "spam",
  copyright: "othersWork",
};

/**
 * The rule a removal names, or none: a copyright notice's takedown names
 * no rule (the Desk acted on a notice, and found nothing itself).
 */
export function removalRuleOf(
  action: "remove" | "quarantine" | "takedown",
  reason: RemovalReason,
): CommunityRule | undefined {
  return isCopyrightTakedown(action, reason) ? undefined : removalRule[reason];
}

/**
 * The band's line naming that rule, or nothing (C8): the same sentence the
 * removal email carries.
 */
export function removalRuleLine(
  action: "remove" | "takedown",
  reason: RemovalReason,
): string | undefined {
  const rule = removalRuleOf(action, reason);
  return rule === undefined ? undefined : ruleLine(rule);
}

/**
 * What Close account asks for beside the reason (C8, D-145): the rule it
 * breaks, or that it is suspected CSAM, whose closure names no rule.
 */
export const closureRules = [...communityRuleKeys, "suspected_csam"] as const;

export type ClosureRule = (typeof closureRules)[number];

export const closureRuleSchema = z.enum(closureRules, {
  message: "Pick the rule it breaks.",
});

/**
The pick's labels: each rule's name, and the CSAM option saying what it does.
*/
export const closureRuleLabels: Readonly<Record<ClosureRule, string>> = {
  ...communityRules,
  suspected_csam: "Suspected CSAM (the notice names no rule)",
};

/**
The rule a closure's email names: none for suspected CSAM.
*/
export function closureRuleOf(rule: ClosureRule): CommunityRule | undefined {
  return rule === "suspected_csam" ? undefined : rule;
}

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
function takedownSentence(subjectType: "entry" | "photo"): string {
  return `We removed ${removedThing(subjectType)} ${COPYRIGHT_NOTICE_CLAUSE}.`;
}

/**
 * Whether a removal answered a copyright notice, so its author is told
 * that rather than a moderator's reason (round 28 #8, R-140).
 *
 * **The action alone does not say so.** A removal request from
 * `/takedown` is also taken down with `action: "takedown"` (design 136),
 * with the reason `intimate`; telling that runner their photo went "after
 * a copyright notice" would be false. The SAF-6 form is the only takedown
 * that carries `copyright`, so the two together are the notice.
 */
export function isCopyrightTakedown(
  action: "remove" | "quarantine" | "takedown",
  reason: RemovalReason,
): boolean {
  return action === "takedown" && reason === "copyright";
}

/**
 * The one sentence a removal's author is told, in the bell row and in the
 * band where the thing was (round 27 #20): the copyright notice's, or the
 * moderator's reason.
 */
export function removalNotice(
  subjectType: "entry" | "photo",
  action: "remove" | "takedown",
  reason: RemovalReason,
): string {
  return isCopyrightTakedown(action, reason)
    ? takedownSentence(subjectType)
    : removalSentence(subjectType, reason);
}

/**
 * What a garment photo's owner is told in the bell when a person removes
 * it (owner, 2026-10-26; R-167): the email's first sentence and the
 * reason. A garment's photo is never taken down over a copyright notice,
 * so there is no takedown sentence for it.
 */
export function garmentRemovalNotice(reason: RemovalReason): string {
  return `${GARMENT_PHOTO_REMOVED}. Reason: ${removalStatements[reason]}.`;
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
