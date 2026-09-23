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

/**
 * How many ids one `IN (…)` list may carry.
 *
 * D1 refuses a statement with more than 100 bound parameters — "too many
 * SQL variables", and the whole query fails, not just the tail. A list
 * read from an upstream `LIMIT 200` is past that the moment a runner has
 * a hundred-odd runs, which is exactly the runner who has the most
 * history to show. 80 leaves room for the statement's other operands (an
 * item id, a user id, a status) without anyone having to count them.
 */
export const IN_LIST_CHUNK = 80;

/**
 * Runs `read` once per chunk of `ids` and concatenates the rows, in chunk
 * order — so a query written as `inArray(column, chunk)` stays under D1's
 * parameter cap however long the list grows.
 *
 * No ids, no query: there are no chunks to read, which is also what an
 * empty `inArray` would have matched.
 */
export async function readInChunks<TId, TRow>(
  ids: readonly TId[],
  read: (chunk: TId[]) => Promise<TRow[]>,
): Promise<TRow[]> {
  const pages = await Promise.all(
    chunked(ids, IN_LIST_CHUNK).map(async (chunk) => read(chunk)),
  );
  return pages.flat();
}
