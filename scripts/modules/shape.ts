/**
 * The module ratchet (design 240, #796 step 3; design 262): six numbers
 * about the modules, measured from the imports, each with a budget. A number at or
 * under its budget moves freely. A number over it is pinned in
 * `test/architecture/module-shape.json` and may only go down:
 * `test/architecture/module-shape.node.test.ts` fails when it rises, and
 * also when it falls and the pin was not lowered, so a gain cannot be
 * given back. `npm run modules:pin` lowers the pins.
 *
 * - **fan-out**, of a module: the other modules its files import,
 *   sub-modules included. `dispatch` is not measured: composing every
 *   module is its job (design 261 ruling 10).
 * - **door width**, of a door (a module's `index.ts`, a sub-module's, or a
 *   module's client-safe `client.ts`, design 255): the names it exports.
 * - **past the door**, of a module: the imports of its files from outside
 *   it that go around its doors, routes' included. An import of
 *   `functions.ts` or of a file in a `components/` folder is not counted: that is how a route
 *   reaches a module (docs/architecture.md). Until design 255 gave routes
 *   `client.ts`, a route's import was not counted either, because a count
 *   with no remedy would only block.
 * - **files**, of a unit (a module, or a sub-module): the files in its
 *   folder, a sub-module's own files not counted in its module's.
 * - **parent door**, of a module that holds a sub-module: the names its
 *   own `index.ts` exports. Its budget is 0, so every one is pinned and
 *   only falls (design 240 rule 4, design 261 ruling 11). It is the one
 *   kind `npm run modules:pin` may add a pin to, when a module is first
 *   split.
 * - **direction**, of the modules as a whole (`modules`): the fewest
 *   imports to cut so that no module reaches itself (`direction.ts`,
 *   design 261 ruling 4).
 *
 * A pin may carry a reason, in the pins file's `reasons`: a ceiling the
 * owner accepted, where a pin with none is a debt (design 261 ruling 10).
 *
 * Pure: facts in, numbers and problems out. The imports are read by
 * dependency-cruiser and the door names by TypeScript (`read.ts`), as the
 * diagram generator reads them, so the ratchet, the diagram and the
 * commit gate agree on what an import is.
 */
import { z } from "zod";

import {
  isWiring,
  owningUnit,
  unitFolders,
  type ImportEdge,
} from "../diagrams/structure";
import {
  DIRECTION_LISTS,
  directionOf,
  type DirectionLists,
  unitName,
} from "./direction";

const MODULES_ROOT = "src/modules/";
const DOOR_FILE = "/index.ts";
const CLIENT_DOOR_FILE = "/client.ts";
/**
A `.ts` file in a `components/` folder is a component's helper: a route may import it.
*/
const COMPONENTS_FOLDER = "/components/";

export const shapeKinds = [
  "fanOut",
  "doorWidth",
  "pastDoor",
  "files",
  "parentDoor",
  "direction",
] as const;
export type ShapeKind = (typeof shapeKinds)[number];

type Numbers = Readonly<Record<string, number>>;

/**
Modules whose fan-out is not measured: they compose the others.
*/
const OUTSIDE_FAN_OUT: ReadonlySet<string> = new Set(["dispatch"]);

/**
The one unit the direction is about.
*/
export const DIRECTION_UNIT = "modules";

/**
Each number, by the module or unit it is about (`feed`, `runs/parsers`).
*/
export type Shape = Readonly<Record<ShapeKind, Numbers>>;

/**
 * Set where every module that is not being broken up passes (design 240,
 * measured on main at 418583f9). The owner's to change.
 */
export const BUDGETS: Readonly<Record<ShapeKind, number>> = {
  fanOut: 7,
  doorWidth: 45,
  pastDoor: 0,
  files: 50,
  parentDoor: 0,
  direction: 0,
};

const WORDS: Readonly<Record<ShapeKind, string>> = {
  fanOut: "the modules it imports",
  doorWidth: "the names its door exports",
  pastDoor: "the imports that go around its doors",
  files: "the files in its folder",
  parentDoor: "the names its parent door exports",
  direction: "the imports to cut so that no module reaches itself",
};

const pinned = z.record(z.string(), z.number().int().positive());
const reasons = z.record(z.string(), z.string().min(1));

/**
`test/architecture/module-shape.json`: the numbers over budget, and why some may stay.
*/
export const pinsSchema = z.strictObject({
  fanOut: pinned,
  doorWidth: pinned,
  pastDoor: pinned,
  files: pinned,
  parentDoor: pinned,
  direction: pinned,
  reasons: z.partialRecord(z.enum(shapeKinds), reasons),
});
export type Pins = z.infer<typeof pinsSchema>;

export interface ShapeFacts {
  /**
  Every `.ts` and `.tsx` file under `src`.
  */
  readonly paths: readonly string[];
  /**
  Every import between two files under `src`, in every form.
  */
  readonly imports: readonly ImportEdge[];
  /**
  Each door under `src/modules` (every `index.ts`, and each module's
  `client.ts`), and the names it exports.
  */
  readonly doorNames: ReadonlyMap<string, readonly string[]>;
}

/**
`src/modules/feed/entries/entries.ts` is in `feed`; a path elsewhere is in none.
*/
function moduleOf(path: string): string | undefined {
  return path.startsWith(MODULES_ROOT)
    ? path.slice(MODULES_ROOT.length).split("/", 1)[0]
    : undefined;
}

function sorted(numbers: ReadonlyMap<string, number>): Numbers {
  return Object.fromEntries(
    [...numbers].toSorted(([a], [b]) => a.localeCompare(b)),
  );
}

function fanOut(facts: ShapeFacts, modules: readonly string[]): Numbers {
  const imported = new Map(
    modules
      .filter((name) => !OUTSIDE_FAN_OUT.has(name))
      .map((name) => [name, new Set<string>()]),
  );
  for (const edge of facts.imports) {
    const from = moduleOf(edge.from);
    const to = moduleOf(edge.to);
    if (from !== undefined && to !== undefined && from !== to) {
      imported.get(from)?.add(to);
    }
  }
  return sorted(new Map([...imported].map(([name, set]) => [name, set.size])));
}

/**
`src/modules/feed/client.ts` is `feed`'s client-safe door; a `client.ts` deeper down is not one.
*/
function isClientDoor(path: string): boolean {
  const module = moduleOf(path);
  return (
    module !== undefined &&
    path === `${MODULES_ROOT}${module}${CLIENT_DOOR_FILE}`
  );
}

/**
 * An import that goes around a module's doors: from outside the module,
 * a route included, to a file that is neither a door nor wiring.
 */
function isPastDoor(edge: ImportEdge): boolean {
  return (
    moduleOf(edge.from) !== moduleOf(edge.to) &&
    !edge.to.endsWith(DOOR_FILE) &&
    !isClientDoor(edge.to) &&
    !isWiring(edge.to) &&
    !edge.to.includes(COMPONENTS_FOLDER)
  );
}

function pastDoor(facts: ShapeFacts, modules: readonly string[]): Numbers {
  const counts = new Map(modules.map((name) => [name, 0]));
  for (const edge of facts.imports) {
    const to = moduleOf(edge.to);
    if (to !== undefined && isPastDoor(edge)) {
      counts.set(to, (counts.get(to) ?? 0) + 1);
    }
  }
  return sorted(counts);
}

/**
 * Each unit's `index.ts`, under the unit's name, and each module's
 * `client.ts`, under `feed/client.ts`: a unit name never ends in `.ts`.
 */
function doorWidth(facts: ShapeFacts, folders: readonly string[]): Numbers {
  const doors = folders.map((folder): [string, number] => {
    const names = facts.doorNames.get(`${folder}${DOOR_FILE}`);
    if (names === undefined) {
      throw new Error(`${folder}${DOOR_FILE} was not read`);
    }
    return [unitName(folder), names.length];
  });
  const clientDoors = [...facts.doorNames]
    .filter(([path]) => isClientDoor(path))
    .map(([path, names]): [string, number] => [unitName(path), names.length]);
  return sorted(new Map([...doors, ...clientDoors]));
}

function files(
  modulePaths: readonly string[],
  folders: readonly string[],
): Numbers {
  const counts = new Map(folders.map((folder) => [unitName(folder), 0]));
  for (const path of modulePaths) {
    const folder = owningUnit(path, folders);
    if (folder === undefined) {
      throw new Error(`${path} is in no module: its folder has no index.ts`);
    }
    const unit = unitName(folder);
    counts.set(unit, (counts.get(unit) ?? 0) + 1);
  }
  return sorted(counts);
}

/**
Each module that holds a sub-module, by the names on its own `index.ts`.
*/
function parentDoor(doorWidths: Numbers, folders: readonly string[]): Numbers {
  const units = folders.map((folder) => unitName(folder));
  return Object.fromEntries(
    Object.entries(doorWidths).filter(
      ([unit]) =>
        !unit.includes("/") &&
        units.some((other) => other.startsWith(`${unit}/`)),
    ),
  );
}

/**
The six numbers, for every module and unit under `src/modules`.
*/
export function measureShape(
  facts: ShapeFacts,
  lists: DirectionLists = DIRECTION_LISTS,
): Shape {
  const modulePaths = facts.paths.filter((path) =>
    path.startsWith(MODULES_ROOT),
  );
  const folders = unitFolders(modulePaths);
  const modules = folders
    .map((folder) => unitName(folder))
    .filter((unit) => !unit.includes("/"));
  const doorWidths = doorWidth(facts, folders);
  return {
    fanOut: fanOut(facts, modules),
    doorWidth: doorWidths,
    pastDoor: pastDoor(facts, modules),
    files: files(modulePaths, folders),
    parentDoor: parentDoor(doorWidths, folders),
    direction: {
      [DIRECTION_UNIT]: directionOf(facts.imports, folders, lists).cuts,
    },
  };
}

function overBudget(numbers: Numbers, budget: number): Record<string, number> {
  return Object.fromEntries(
    Object.entries(numbers).filter(([, value]) => value > budget),
  );
}

/**
What the pins file holds for this shape: each number over its budget, and no reasons.
*/
export function pinsOf(
  shape: Shape,
  budgets: Readonly<Record<ShapeKind, number>> = BUDGETS,
): Pins {
  return {
    fanOut: overBudget(shape.fanOut, budgets.fanOut),
    doorWidth: overBudget(shape.doorWidth, budgets.doorWidth),
    pastDoor: overBudget(shape.pastDoor, budgets.pastDoor),
    files: overBudget(shape.files, budgets.files),
    parentDoor: overBudget(shape.parentDoor, budgets.parentDoor),
    direction: overBudget(shape.direction, budgets.direction),
    reasons: {},
  };
}

/**
The kinds `npm run modules:pin` may add a pin to: a module split for the first time.
*/
const ADDABLE: ReadonlySet<ShapeKind> = new Set(["parentDoor"]);

const OWNER_ONLY =
  "a pin is raised or added only on the owner's say, by hand in " +
  "test/architecture/module-shape.json.";
const REMEDY = `Bring it back down, or propose a sub-module (design 240, CLAUDE.md); ${OWNER_ONLY}`;
const REMEDIES: Readonly<Record<ShapeKind, string>> = {
  fanOut: REMEDY,
  doorWidth: REMEDY,
  pastDoor: REMEDY,
  files: REMEDY,
  parentDoor:
    "Export the name from the sub-module's door, and import it from there " +
    `(design 240 rule 4); ${OWNER_ONLY}`,
  direction:
    "Cut the import: move the code to the module below, or hand the " +
    "function in from a functions.ts (docs/architecture.md, Composing " +
    "across modules). `npm run modules:pin -- --print` names the imports " +
    `to cut; ${OWNER_ONLY}`,
};
const LOWER = "Run `npm run modules:pin` and commit the result.";

interface Reading {
  readonly kind: ShapeKind;
  readonly unit: string;
  readonly value: number;
  readonly pin: number | undefined;
  readonly budget: number;
}

/**
What is wrong with a number nothing pins, if anything.
*/
function unpinnedProblem(reading: Reading, what: string): string | undefined {
  const { kind, value, budget } = reading;
  if (value <= budget) return undefined;
  const remedy = ADDABLE.has(kind)
    ? `A module split for the first time is pinned where it stands. ${LOWER}`
    : REMEDIES[kind];
  return `${what} is ${String(value)}, over the budget of ${String(budget)}, and not pinned. ${remedy}`;
}

/**
What is wrong with one number, if anything.
*/
function readingProblem(reading: Reading): string | undefined {
  const { kind, unit, value, pin, budget } = reading;
  const what = `${unit}: ${WORDS[kind]} (${kind})`;
  if (pin === undefined) return unpinnedProblem(reading, what);
  if (value > pin) {
    return `${what} rose from ${String(pin)} to ${String(value)}. ${REMEDIES[kind]}`;
  }
  if (value < pin) {
    return `${what} fell from ${String(pin)} to ${String(value)}: lower the pin so it cannot rise again. ${LOWER}`;
  }
  return value > budget
    ? undefined
    : `${what} is pinned at ${String(pin)}, which is within the budget of ${String(budget)}: the pin is done. ${LOWER}`;
}

function kindProblems(
  kind: ShapeKind,
  numbers: Numbers,
  pins: Numbers,
  budget: number,
): string[] {
  const readings = Object.entries(numbers).map(([unit, value]) =>
    readingProblem({ kind, unit, value, pin: pins[unit], budget }),
  );
  const gone = Object.keys(pins)
    .filter((unit) => !Object.hasOwn(numbers, unit))
    .map(
      (unit) =>
        `${unit}: ${kind} is pinned, and no such unit is left. ${LOWER}`,
    );
  return [...readings.filter((problem) => problem !== undefined), ...gone];
}

/**
A reason left on a pin that is gone: it would explain the next pin of that name.
*/
function reasonProblems(pins: Pins): string[] {
  return shapeKinds.flatMap((kind) =>
    Object.keys(pins.reasons[kind] ?? {})
      .filter((unit) => !Object.hasOwn(pins[kind], unit))
      .map(
        (unit) =>
          `${unit}: the reason for its ${kind} pin is left, and the pin is not. ${LOWER}`,
      ),
  );
}

/**
 * Every way the shape and the pins disagree, as a sentence each. Empty
 * when each number is within its budget or exactly at its pin, and each
 * reason has its pin.
 */
export function shapeProblems(
  shape: Shape,
  pins: Pins,
  budgets: Readonly<Record<ShapeKind, number>> = BUDGETS,
): string[] {
  return [
    ...shapeKinds.flatMap((kind) =>
      kindProblems(kind, shape[kind], pins[kind], budgets[kind]),
    ),
    ...reasonProblems(pins),
  ];
}

/**
The reasons whose pins `next` keeps.
*/
function keptReasons(reasons: Pins["reasons"], next: Pins): Pins["reasons"] {
  return Object.fromEntries(
    shapeKinds.flatMap((kind) => {
      const kept = Object.entries(reasons[kind] ?? {}).filter(([unit]) =>
        Object.hasOwn(next[kind], unit),
      );
      return kept.length === 0 ? [] : [[kind, Object.fromEntries(kept)]];
    }),
  );
}

/**
 * The pins file for this shape, for `npm run modules:pin` to write.
 * Throws when writing it would raise a pin, or add one of a kind not in
 * `ADDABLE`: the command only lowers. A reason stays while its pin does.
 * With no pins yet (`undefined`), it writes the first set.
 */
export function repinned(
  shape: Shape,
  pins: Pins | undefined,
  budgets: Readonly<Record<ShapeKind, number>> = BUDGETS,
): Pins {
  const next = pinsOf(shape, budgets);
  if (pins === undefined) return next;
  const ceiling = (kind: ShapeKind, unit: string): number =>
    pins[kind][unit] ??
    (ADDABLE.has(kind) ? Infinity : budgets[kind]);
  const raised = shapeKinds.flatMap((kind) =>
    Object.entries(next[kind])
      .filter(([unit, value]) => value > ceiling(kind, unit))
      .map(
        ([unit, value]) =>
          `${unit}: ${WORDS[kind]} (${kind}) is ${String(value)}, and is pinned at ${String(pins[kind][unit] ?? "nothing")}`,
      ),
  );
  if (raised.length > 0) {
    throw new Error(`${raised.join("\n")}\n${REMEDY}`);
  }
  return { ...next, reasons: keptReasons(pins.reasons, next) };
}
