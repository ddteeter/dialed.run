/**
 * The highest-counted entries of a tally, without `Array#sort`.
 *
 * Two modules were doing this by hand: the closet's "pairs with" and the
 * profile's "most worn" are the same selection over the same shape, and
 * both had grown their own loop — one returning ids, one returning pairs,
 * neither tested. A hand-written second copy of a selection is not a
 * duplicate of the truth, it is a rival one.
 *
 * `sort` is out because the house lint rules want `Array#toSorted`, which
 * needs an ES2023 lib this project does not enable. A bounded selection
 * avoids the question: both callers ask for two or five.
 */

/**
 * The single highest-counted entry, or `undefined` for an empty tally.
 * Ties go to the one enumerated first, which for a `Map` is insertion
 * order — arbitrary, but stable, which is what a list rendered twice needs.
 */
function highest(
  counts: ReadonlyMap<string, number>,
): [string, number] | undefined {
  let best: [string, number] | undefined;
  for (const entry of counts) {
    if (best === undefined || entry[1] > best[1]) best = entry;
  }
  return best;
}

/**
 * Up to `limit` entries, highest count first. Never repeats an entry, and
 * never pads: a tally with fewer than `limit` entries yields all of them.
 */
export function topByCount(
  counts: ReadonlyMap<string, number>,
  limit: number,
): [string, number][] {
  const remaining = new Map(counts);
  const top: [string, number][] = [];
  while (top.length < limit) {
    const best = highest(remaining);
    if (best === undefined) break;
    remaining.delete(best[0]);
    top.push(best);
  }
  return top;
}
