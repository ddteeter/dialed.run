/**
 * The module ratchet's direction (design 261 ruling 4, design 262): the
 * fewest imports to cut so that no module reaches itself through what it
 * imports. 0 means the modules can be put in one order where each imports
 * only those below it.
 *
 * What it reads is the modules' service code and their components, type
 * imports included. Two kinds of file sit outside it, because composing
 * the modules is their job:
 *
 * - each `functions.ts`, a module's wiring (docs/architecture.md);
 * - the composers in `DIRECTION_LISTS`: the dispatch, which runs every
 *   module's jobs, and `account/purge`, which forgets a runner in every
 *   area.
 *
 * The floor units in `DIRECTION_LISTS` count apart from the module that
 * holds them, so a module that their parent imports may still import
 * them. Each imports no feature module.
 *
 * Pure: the imports in, the number and the imports to cut out.
 */
import { owningUnit, type ImportEdge } from "../diagrams/structure";

const MODULES_ROOT = "src/modules/";
const FUNCTIONS_FILE = "/functions.ts";

/**
The units the direction reads apart from their modules, by unit name.
*/
export interface DirectionLists {
  /**
  Units that compose the modules: outside the direction, with everything in them.
  */
  readonly composers: readonly string[];
  /**
  Units under every area: each counts as a module of its own.
  */
  readonly floor: readonly string[];
}

/**
The lists the ratchet reads (design 261 ruling 4). The owner's to change.
*/
export const DIRECTION_LISTS: DirectionLists = {
  composers: ["account/purge", "dispatch"],
  floor: ["ops/outbox", "ops/sentry", "safety/rules"],
};

/**
 * The most units one group that all reach each other may hold. The exact
 * order is found over every subset of a group, so it doubles with each
 * unit; today the largest group is a handful.
 */
const LARGEST_GROUP = 20;

function isAtOrUnder(unit: string, outer: string): boolean {
  return unit === outer || unit.startsWith(`${outer}/`);
}

/**
`src/modules/runs/parsers` is `runs/parsers`.
*/
export function unitName(folder: string): string {
  return folder.slice(MODULES_ROOT.length);
}

/**
 * What the direction calls the unit a file is in: a floor unit's name, its
 * module's name, or `undefined` for a file outside the direction.
 */
function nodeOf(
  path: string,
  folders: readonly string[],
  lists: DirectionLists,
): string | undefined {
  const folder = owningUnit(path, folders);
  if (folder === undefined || path.endsWith(FUNCTIONS_FILE)) return undefined;
  const unit = unitName(folder);
  if (lists.composers.some((outer) => isAtOrUnder(unit, outer))) {
    return undefined;
  }
  const floor = lists.floor.find((name) => isAtOrUnder(unit, name));
  return floor ?? unit.split("/", 1)[0];
}

/**
 * Throws on a listed name that is no unit: a list that names a folder no
 * longer there would quietly count nothing apart.
 */
function requireUnits(folders: readonly string[], lists: DirectionLists): void {
  const units = new Set(folders.map((folder) => unitName(folder)));
  const missing = [...lists.composers, ...lists.floor].filter(
    (name) => !units.has(name),
  );
  if (missing.length > 0) {
    throw new Error(
      `${missing.join(", ")}: listed in scripts/modules/direction.ts, and no unit has that name`,
    );
  }
}

/**
One pair of units the direction would cut, and the imports that make it.
*/
export interface Cut {
  readonly from: string;
  readonly to: string;
  readonly imports: readonly ImportEdge[];
}

export interface Direction {
  /**
  The fewest imports to cut so that no unit reaches itself.
  */
  readonly cuts: number;
  /**
  Those imports, by the pair of units they join.
  */
  readonly pairs: readonly Cut[];
}

/**
Each pair of units an import joins, as `from to`, with its imports.
*/
function pairsOf(
  imports: readonly ImportEdge[],
  folders: readonly string[],
  lists: DirectionLists,
): Map<string, ImportEdge[]> {
  const pairs = new Map<string, ImportEdge[]>();
  for (const edge of imports) {
    const from = nodeOf(edge.from, folders, lists);
    const to = nodeOf(edge.to, folders, lists);
    if (from === undefined || to === undefined || from === to) continue;
    const key = `${from} ${to}`;
    pairs.set(key, [...(pairs.get(key) ?? []), edge]);
  }
  return pairs;
}

type Graph = ReadonlyMap<string, ReadonlyMap<string, number>>;

function graphOf(pairs: ReadonlyMap<string, readonly ImportEdge[]>): Graph {
  const graph = new Map<string, Map<string, number>>();
  for (const [key, edges] of pairs) {
    const [from = "", to = ""] = key.split(" ", 2);
    const out = graph.get(from) ?? new Map<string, number>();
    out.set(to, edges.length);
    graph.set(from, out);
    if (!graph.has(to)) graph.set(to, new Map());
  }
  return graph;
}

function reachable(graph: Graph, start: string): Set<string> {
  const seen = new Set([start]);
  const queue = [start];
  for (let next = queue.pop(); next !== undefined; next = queue.pop()) {
    const out = graph.get(next) ?? new Map<string, number>();
    for (const to of out.keys()) {
      if (seen.has(to)) continue;
      seen.add(to);
      queue.push(to);
    }
  }
  return seen;
}

function byName(a: string, b: string): number {
  return a.localeCompare(b);
}

/**
 * The groups of units that all reach each other, each sorted, with more
 * than one unit. A cut only ever falls inside one, so each is ordered on
 * its own.
 */
function groupsOf(graph: Graph): string[][] {
  const units = [...graph].map(([unit]) => unit).toSorted(byName);
  const reaches = new Map(units.map((unit) => [unit, reachable(graph, unit)]));
  const isMutual = (unit: string, other: string): boolean =>
    reaches.get(unit)?.has(other) === true &&
    reaches.get(other)?.has(unit) === true;
  const groups = new Map<string, string[]>();
  for (const unit of units) {
    const group = units.filter((other) => isMutual(unit, other));
    if (group.length > 1) groups.set(group.join(" "), group);
  }
  return [...groups].map(([, group]) => group);
}

function sum(values: readonly number[]): number {
  let total = 0;
  for (const value of values) total += value;
  return total;
}

/**
 * The order of one group that cuts the fewest imports, lowest first, by
 * the exact search over its subsets: `best[set]` is the fewest cuts with
 * the units of `set` (a bit each) placed lowest, and placing `unit` next
 * cuts every import into it from the units already placed.
 */
function bestOrder(group: readonly string[], graph: Graph): string[] {
  if (group.length > LARGEST_GROUP) {
    throw new Error(
      `${group.join(", ")} all reach each other: ${String(group.length)} units, more than the direction can order (${String(LARGEST_GROUP)})`,
    );
  }
  const into = (set: number, unit: string): number =>
    sum(
      group
        .filter((_, at) => (set & (1 << at)) !== 0)
        .map((below) => graph.get(below)?.get(unit) ?? 0),
    );
  const all = (1 << group.length) - 1;
  const best = Array.from({ length: all + 1 }, () => Infinity);
  const last = Array.from({ length: all + 1 }, () => 0);
  best[0] = 0;
  for (let set = 0; set < all; set += 1) {
    for (const [index, unit] of group.entries()) {
      const next = set | (1 << index);
      const cost = (best[set] ?? Infinity) + into(set, unit);
      if (next === set || cost >= (best[next] ?? Infinity)) continue;
      best[next] = cost;
      last[next] = index;
    }
  }
  const order: string[] = [];
  for (let set = all; set !== 0; set &= ~(1 << (last[set] ?? 0))) {
    order.unshift(group[last[set] ?? 0] ?? "");
  }
  return order;
}

/**
The imports from a unit lower in `order` to one above it.
*/
function upward(
  order: readonly string[],
  pairs: ReadonlyMap<string, readonly ImportEdge[]>,
): Cut[] {
  const cuts: Cut[] = [];
  for (const [low, from] of order.entries()) {
    const above = order.slice(low + 1);
    for (const to of above) {
      const imports = pairs.get(`${from} ${to}`);
      if (imports !== undefined) cuts.push({ from, to, imports });
    }
  }
  return cuts;
}

/**
The direction of the modules, from every import under `src` and the unit folders.
*/
export function directionOf(
  imports: readonly ImportEdge[],
  folders: readonly string[],
  lists: DirectionLists = DIRECTION_LISTS,
): Direction {
  requireUnits(folders, lists);
  const pairs = pairsOf(imports, folders, lists);
  const graph = graphOf(pairs);
  const cuts = groupsOf(graph)
    .flatMap((group) => upward(bestOrder(group, graph), pairs))
    .toSorted((a, b) => byName(a.from, b.from) || byName(a.to, b.to));
  return {
    cuts: sum(cuts.map((cut) => cut.imports.length)),
    pairs: cuts,
  };
}
