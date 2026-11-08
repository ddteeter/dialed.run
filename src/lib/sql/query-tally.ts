/**
 * What one request asked D1 (design 182, part 2): statements run, each
 * statement inside a batch counting once, and the rows D1 says it read.
 * `d1-session.ts` keeps one per tallied scope; the arithmetic is here,
 * apart from the plumbing, so it can be measured on its own.
 */
export interface QueryTally {
  readonly statements: number;
  readonly rowsRead: number;
}

export const NO_QUERIES: QueryTally = { statements: 0, rowsRead: 0 };

/**
 * The rows a `D1Result` says it read. D1 types `meta.rows_read` as a
 * number; a result that carries none (a fake, or a future runtime) reads
 * as zero rather than poisoning the sum with `NaN`.
 */
export function rowsReadOf(result: {
  readonly meta: { readonly rows_read?: number };
}): number {
  return result.meta.rows_read ?? 0;
}

/**
`tally` with one more statement, which read `rowsRead` rows.
*/
export function addStatement(tally: QueryTally, rowsRead: number): QueryTally {
  return {
    statements: tally.statements + 1,
    rowsRead: tally.rowsRead + rowsRead,
  };
}
