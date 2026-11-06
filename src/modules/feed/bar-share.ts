import { uiGroupLabels } from "./groups";
import type { UiGroup } from "./groups";

/**
 * Which word each consensus bar carries (round 26 #9: colour is never
 * alone, rule 10), as round 35 #54 words them, amending round 27 #25:
 * "The words claim a share of matched runners, not a rank."
 *
 * - **All** — every matched runner wore it, whatever sits beside it.
 * - **Most** — more than half of them.
 * - **Some** — anything less, a lone bar at 3 of 14 and a leader at 5 of
 *   14 included.
 *
 * Each bar is read against the matched runners alone, never against the
 * other bars: groups overlap (one runner counts in every group they
 * wore), so two bars can both read Most. Round 27's "Split" is dropped;
 * equal bars carry the same word and the same width, which is the tie.
 *
 * Pink is every word but Some: the quiet grey is the one that says "not
 * most of them".
 */
export type BarShare = "all" | "most" | "some";

/**
Each row with its word, in the rows' own order, out of `matched` runners.
*/
export function withShares<Row extends { readonly runners: number }>(
  rows: readonly Row[],
  matched: number,
): { row: Row; share: BarShare }[] {
  return rows.map((row) => ({ row, share: shareOf(row.runners, matched) }));
}

function shareOf(runners: number, matched: number): BarShare {
  if (runners >= matched) return "all";
  return runners * 2 > matched ? "most" : "some";
}

/**
 * Each word as the bars and the sentence say it (round 26 #9: a bar's
 * colour is never alone).
 */
export const SHARE_WORDS = {
  all: "All",
  most: "Most",
  some: "Some",
} as const satisfies Record<BarShare, string>;

/**
 * E2-lite's summary sentence (Feed board, through round 27; round 47
 * #114): what the matched runners who called it dialed wore, in round 35
 * #54's share words over those runners alone — "Most got it right in tops
 * and bottoms. Some added hands / head."
 *
 * The first word that has groups leads with "got it right in", and every
 * word after it "added": All, then Most, then Some. The groups are the
 * dialed runners' rows, two runners or more to a row, as the bars are
 * (`shownGroups`), named as the bars name them. No dialed runners, or none
 * two to a group, is no sentence: the block above it still stands.
 */
export function summarySentence(
  dialed: Readonly<{
    runners: number;
    groups: readonly { group: UiGroup; runners: number }[];
  }>,
): string | undefined {
  const shares = withShares(dialed.groups, dialed.runners);
  const clauses = SHARE_ORDER.map((share) => ({
    share,
    groups: shares
      .filter((bar) => bar.share === share)
      .map((bar) => bar.row.group),
  })).filter((clause) => clause.groups.length > 0);
  if (clauses.length === 0) return undefined;
  const list = new Intl.ListFormat("en", { type: "conjunction" });
  return clauses
    .map(({ share, groups }, index) => {
      const named = list.format(
        groups.map((group) => uiGroupLabels[group].toLowerCase()),
      );
      const verb = index === 0 ? "got it right in" : "added";
      return `${SHARE_WORDS[share]} ${verb} ${named}.`;
    })
    .join(" ");
}

const SHARE_ORDER = [
  "all",
  "most",
  "some",
] as const satisfies readonly BarShare[];
