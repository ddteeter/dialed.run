import { garmentTypeWord } from "../../lib/contracts/garment-fields";
import type { GarmentType } from "../../lib/contracts/garment-fields";
import { uiGroups } from "./groups";
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
 * One garment type the dialed runners wore, two or more of them to it:
 * the sentence's unit (round 49, R49·137a′).
 */
export interface DialedType {
  type: GarmentType;
  runners: number;
  /**
  The earliest of C's rail groups it was worn in, for the clause's order.
  */
  group: UiGroup;
  /**
  When it was last dialed, for the tie-break past three.
  */
  lastDialedAt: number;
}

/**
 * E2-lite's summary sentence (Feed board, through round 27; round 47 #114;
 * round 49 #137): what the matched runners who called it dialed wore, in
 * round 35 #54's share words over those runners alone — "Most got it
 * right in long sleeve and shorts. Some added gloves."
 *
 * - **Types, not groups** (137a′): each in the sentence's own word,
 *   `garmentTypeWord`. No fallback to category (137b′): each type is
 *   named at its own strength, and #114's fewer-than-2 rule has already
 *   dropped any that fewer than 2 wore.
 * - **Tiers** (137c′): clauses go All, then Most, then Some. The first
 *   reads "got it right in" and each later one "added". There is no merge.
 * - **At most three to a clause** (137b′): past three, the lowest counts
 *   drop, ties to the one dialed most recently. Those kept go in C's rail
 *   group order, then by count.
 * - **A serial comma** (137c): "long sleeve, shorts, and gloves".
 *
 * No dialed runners, or no type two to it, is no sentence: the block
 * above it still stands.
 */
export function summarySentence(
  dialed: Readonly<{ runners: number; types: readonly DialedType[] }>,
): string | undefined {
  const shares = withShares(dialed.types, dialed.runners);
  const clauses = SHARE_ORDER.map((share) => ({
    share,
    types: clauseTypes(
      shares.filter((bar) => bar.share === share).map((bar) => bar.row),
    ),
  })).filter((clause) => clause.types.length > 0);
  if (clauses.length === 0) return undefined;
  const list = new Intl.ListFormat("en");
  return clauses
    .map(({ share, types }, index) => {
      const named = list.format(types.map((row) => garmentTypeWord(row.type)));
      const verb = index === 0 ? "got it right in" : "added";
      return `${SHARE_WORDS[share]} ${verb} ${named}.`;
    })
    .join(" ");
}

/**
The most a clause names (round 49, 137b′).
*/
const CLAUSE_MAX = 3;

/**
 * One clause's types: the three strongest, ties to the most recently
 * dialed, then put in rail group order. The second sort is stable, so
 * within a group they stay by count.
 */
function clauseTypes(types: readonly DialedType[]): DialedType[] {
  return types
    .toSorted(
      (a, b) => b.runners - a.runners || b.lastDialedAt - a.lastDialedAt,
    )
    .slice(0, CLAUSE_MAX)
    .toSorted((a, b) => uiGroups.indexOf(a.group) - uiGroups.indexOf(b.group));
}

const SHARE_ORDER = [
  "all",
  "most",
  "some",
] as const satisfies readonly BarShare[];
