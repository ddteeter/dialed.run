/**
 * The current time as whole unix seconds — the unit every timestamp column
 * in `src/db/schema*.ts` stores.
 *
 * `Math.floor(Date.now() / 1000)` was written out 29 times across 19 files
 * before this existed, which is a rival truth of the cheapest kind: nothing
 * makes two copies disagree loudly, and the one that drifts (milliseconds
 * into a seconds column, a `round` where the others `floor`) writes a
 * timestamp a thousand times too large and is read back as a date in the
 * year 56000 rather than as an error. Raised on PR #73.
 *
 * `floor`, not `round`: a timestamp must never name a second that has not
 * happened yet, or a row can be created "after" a sweep that then skips it.
 */
export function nowSeconds(): number {
  return Math.floor(Date.now() / 1000);
}
