/**
 * Which word each consensus bar carries (round 26 #9: colour is never
 * alone, rule 10), as round 27 #25 words them and the Feed board repeats
 * ("Most / Some, Split on ties, All alone"):
 *
 * - **All** — the only bar. Nothing else was worn by enough runners to
 *   show, so there is nothing to lead.
 * - **Split** — each bar tied for the lead. Neither is "most" of anything
 *   the other is not.
 * - **Most** — more than half the runners who matched.
 * - **Some** — the rest.
 *
 * Pink is every word but Some: the quiet grey is the one that says "not
 * the lead".
 */
export type BarShare = "all" | "split" | "most" | "some";

/**
Each row with its word, in the rows' own order.
*/
export function withShares<Row extends { readonly runners: number }>(
  rows: readonly Row[],
  total: number,
): { row: Row; share: BarShare }[] {
  const lead = Math.max(...rows.map((row) => row.runners));
  const isTied = rows.filter((row) => row.runners === lead).length > 1;
  return rows.map((row) => ({ row, share: shareOf(row.runners) }));

  function shareOf(runners: number): BarShare {
    if (rows.length === 1) return "all";
    if (isTied && runners === lead) return "split";
    return runners * 2 > total ? "most" : "some";
  }
}
