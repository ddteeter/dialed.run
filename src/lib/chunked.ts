/**
 * Split a list into runs of at most `size`, in order.
 *
 * Pulled out of `feed/conditions.ts`, where the same index loop carried
 * three `Stryker disable` directives — the mutants were unkillable *there*
 * because chunking only changes what a query **scans**, and the answer is
 * assembled by matching keys afterwards. Scanned rows are what D1 bills,
 * so the chunking is load-bearing even though no assertion about the
 * result can see it.
 *
 * Here the same mutants are ordinary: a wrong step, a wrong slice or a
 * wrong bound changes the chunks themselves, and a test can just look at
 * them. Moving the code was cheaper than proving three equivalences, and
 * it leaves the caller saying what it means.
 */
export function chunked<TItem>(
  items: readonly TItem[],
  size: number,
): TItem[][] {
  const chunks: TItem[][] = [];
  for (let index = 0; index < items.length; index += size) {
    chunks.push(items.slice(index, index + size));
  }
  return chunks;
}
