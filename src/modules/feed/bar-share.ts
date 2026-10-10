/**
 * Which word each consensus bar carries (round 26 #9: colour is never
 * alone, rule 10), as round 27 #25 words them — "Leading bar \"Most\", the
 * rest \"Some\". A tie for the lead reads \"Split\" on each tied bar. A
 * single bar reads \"All\"." — and the Feed board repeats ("Most / Some,
 * Split on ties, All alone"):
 *
 * - **All** — the only bar.
 * - **Split** — each bar tied for the lead.
 * - **Most** — the one leading bar.
 * - **Some** — the rest.
 *
 * The words rank the bars against each other and never claim a share of
 * the runners: groups overlap (one runner counts in every group they
 * wore), so a leading bar can be under half and still lead. Whether a lone
 * bar short of every runner should still read "All" is open with design
 * (`docs/design-deltas.md` open item 54); the ruling says it does.
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
): { row: Row; share: BarShare }[] {
  const lead = Math.max(...rows.map((row) => row.runners));
  const leaders = rows.filter((row) => row.runners === lead).length;
  return rows.map((row) => ({ row, share: shareOf(row.runners) }));

  function shareOf(runners: number): BarShare {
    if (rows.length === 1) return "all";
    if (runners !== lead) return "some";
    return leaders > 1 ? "split" : "most";
  }
}
