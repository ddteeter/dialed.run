import { useState } from "react";

/**
 * Rows the viewer has already acted on, and the list with them gone.
 *
 * **Optimistic, and safe to be in both places that use it.** `unblockRunner`
 * is an idempotent delete and `resolveReview` refuses a second decision on
 * the same row, so the worst case of a failed request is a row that comes
 * back on the next load — never a decision that silently did not happen.
 *
 * A set rather than an array because membership is the only question asked
 * of it, and the two callers had written the same five lines each: the
 * clone detector was right that this is one idea, not two.
 */
export function useSettled<T>(
  rows: readonly T[],
  idOf: (row: T) => string,
): { remaining: readonly T[]; settle: (id: string) => void } {
  const [settled, setSettled] = useState<ReadonlySet<string>>(
    () => new Set<string>(),
  );
  return {
    remaining: rows.filter((row) => !settled.has(idOf(row))),
    settle: (id) => {
      setSettled((ids) => new Set(ids).add(id));
    },
  };
}
