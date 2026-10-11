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
