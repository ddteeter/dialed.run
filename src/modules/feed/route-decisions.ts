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
 * The band this entry's conditions fall in, and this runner's history in
 * it — or neither, when the entry has no conditions to place it.
 *
 * The history is what A3 reads beneath its verdict row ("your history in
 * this band") and what its generated chips are chosen from, so there is
 * nothing to say or suggest without a band. Asking anyway would be a
 * query per verdict on an indoor run.
 *
 * Generic over what "history" is, so the caller decides what to fetch and
 * this decides only whether there is a band to fetch it for.
 */
export async function bandContextFor<THistory>(
  entry: { conditions: { feelsLikeC: number } | undefined },
  bandFloorFor: (feelsLikeC: number) => number,
  historyFor: (bandFloorC: number) => Promise<THistory>,
): Promise<{ bandFloor: number | undefined; history: THistory | undefined }> {
  if (entry.conditions === undefined) {
    return { bandFloor: undefined, history: undefined };
  }
  const bandFloor = bandFloorFor(entry.conditions.feelsLikeC);
  return { bandFloor, history: await historyFor(bandFloor) };
}

/**
 * Whether the verdict backlog is worth opening.
 *
 * DS2: *"only reachable when ≥2 runs lack a verdict; with one, the S1
 * prompt opens A3 in the panel like the phone."* A table of one row is a
 * table pretending to be a sheet, and the whole argument for the surface
 * is that *"a keyboard and a table beat six sheets"* — which one sheet
 * does not.
 *
 * It is here rather than in `backlog.ts` for this file's own reason: the
 * Feed route and the backlog route both ask it, and `backlog.ts` reaches
 * `src/env`, so importing the answer from there would pull
 * `cloudflare:workers` into the client bundle — which only the production
 * client build catches.
 */
export const BACKLOG_MINIMUM = 2;

export function isBacklogWorthOpening(unjudgedCount: number): boolean {
  return unjudgedCount >= BACKLOG_MINIMUM;
}
