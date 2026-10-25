/**
 * The terms' "The rules" (`docs/legal/terms.md`), one key each, and the
 * pieces of a DSA statement of reasons (Art. 17(3), D-145) that more than
 * one module writes: the removal email, the closure email and the band
 * where a removed thing was.
 *
 * **The names are the terms' own**, the bold words of each bullet after
 * "do not:". `test/lib/community-rules.test.ts` reads `terms.md` and fails
 * when one stops matching, so the terms stay the truth and this is read
 * from them rather than written beside them.
 *
 * Isomorphic: the email module (server) and a safety component (client)
 * both read it.
 */
import { z } from "zod";

export const communityRules = {
  law: "Break the law",
  harassment: "Harass anyone",
  impersonation: "Impersonate anyone",
  home: "Show where someone lives",
  explicit: "Post sexual or explicit content",
  othersPhotos: "Post photos of other people",
  spam: "Post spam, advertising or promotion we have not allowed",
  othersWork: "Post someone else's work",
  system: "Get round the system",
  banEvasion: "Make another account",
} as const;

export type CommunityRule = keyof typeof communityRules;

/**
The rules in the terms' order, read from the table above.
*/
export const communityRuleKeys = Object.keys(communityRules) as [
  CommunityRule,
  ...CommunityRule[],
];

export const communityRuleSchema = z.enum(communityRuleKeys);

/**
 * The rule as a statement of reasons names it (owner, 2026-10-22: "That
 * breaks our community rules: [rule name]"). The terms list what not to
 * do, so the name follows "don't", lower-cased.
 */
export function ruleLine(rule: CommunityRule): string {
  const name = communityRules[rule];
  return `That breaks our community rules: don't ${name.charAt(0).toLowerCase()}${name.slice(1)}.`;
}

/**
 * Who decided (Art. 17(3)(c)), in the owner's words: a person always
 * does, and the automatic check is named when it is what flagged the
 * thing (a review row from the classifier).
 */
export function decidedBy(isFlagged: boolean): string {
  return isFlagged
    ? "Our automatic check flagged it; a person made the decision."
    : "A person made this decision.";
}

/**
 * The redress line (Art. 17(3)(f)) every removal and closure email ends
 * with, in the owner's words.
 */
export const REDRESS_FOOT =
  "Think we got it wrong? Reply to this email and a person will look again. You can also take it to a court.";

/**
 * Where the rules are read: the terms' "## The rules", by the id the
 * terms page gives that heading (GitHub's, `account/legal-markdown.ts`).
 * The removal email's button opens it (round 40 C3); a test pins the id
 * to `terms.md`.
 */
export const COMMUNITY_RULES_PATH = "/terms#the-rules";
