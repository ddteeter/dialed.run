/**
 * The two decisions that used to be ternaries in feed route loaders.
 *
 * They live in their own file, not in `entries.ts`, because **a route
 * imports them and a route is in the client bundle.** `entries.ts` reaches
 * `src/env`, so importing a decision from it made the client build pull in
 * `cloudflare:workers` — which only the production client build catches,
 * not tsc and not the test suite.
 *
 * So the rule is the same one the module boundary already states, applied
 * one level down: anything a route imports at module scope must be
 * reachable without `env`. Both functions here take their expensive halves
 * as callbacks for exactly that reason — the caller owns the queries.
 */

/**
 * Whether to ask this viewer for a verdict on this entry.
 *
 * Three things have to be true, and the cheap ones are checked first so a
 * stranger's page never costs a query: it has to be the author's own
 * entry, and it has to have no verdict yet. `hasBudget` is the expensive
 * half — it reads the once-only budget — so it is a callback rather than a
 * value, and it is not called unless the first two hold.
 */
export async function shouldAskForVerdict(
  entry: { userId: string; verdict: number | undefined },
  viewerId: string | undefined,
  hasBudget: () => Promise<boolean>,
): Promise<boolean> {
  // `!==` alone: a signed-out viewer's `undefined` is not equal to any
  // author id either, so an explicit undefined check would be the same
  // answer written twice.
  if (viewerId !== entry.userId) return false;
  if (entry.verdict !== undefined) return false;
  return hasBudget();
}

/**
 * The band this entry's conditions fall in, and the counts for it — or
 * neither, when the entry has no conditions to place it.
 *
 * The counts are what let the verdict screen say "you were cold at this
 * temperature 3 times before", so there is nothing to say without a band.
 * Asking anyway would be a query per verdict on an indoor run.
 */
export async function bandContextFor<TCounts>(
  entry: { conditions: { feelsLikeC: number } | undefined },
  bandFloorFor: (feelsLikeC: number) => number,
  countsFor: (bandFloorC: number) => Promise<TCounts>,
): Promise<{ bandFloor: number | undefined; bandCounts: TCounts | undefined }> {
  if (entry.conditions === undefined) {
    return { bandFloor: undefined, bandCounts: undefined };
  }
  const bandFloor = bandFloorFor(entry.conditions.feelsLikeC);
  return { bandFloor, bandCounts: await countsFor(bandFloor) };
}
