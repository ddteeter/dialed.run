/**
 * Which Mutation shards a PR runs (design 259). One shard per entry of
 * `stryker.conf.json`'s `mutate` array; a PR keeps the ones its diff can
 * affect, and a push to `main` keeps them all.
 *
 * A shard is kept when (a) a changed file is in its scope, (b) a changed
 * test is one main's report for the shard lists as covering or killing a
 * mutant, or (c) a changed file outside every scope is imported, through
 * any chain, by a file in its scope. (a) and (b) are what the shard's
 * `--incremental` run re-tests; (c) is the import a report cannot see. A
 * shard with no report to read is kept. Every shard is kept when the diff
 * touches what every shard runs on, or when the graph cannot answer.
 *
 * Pure: the changed files, the import graph and the reports' coverage in,
 * the shards out. The graph is read in `graph.ts`, the coverage in
 * `coverage.ts`, and the CLI is `scripts/mutation-shards.ts`.
 */
import nodePath from "node:path";

export interface Shard {
  /**
  The entry as `stryker.conf.json` holds it: what `--mutate` is given.
  */
  readonly mutate: string;
  /**
  The shard's job name after "Mutation score: ", and the required-check
  text a human reads. Not the glob, which runs to 900 characters.
  */
  readonly name: string;
  /**
  The name made safe for an artifact name: `stryker-incremental-<slug>`.
  */
  readonly slug: string;
}

/**
`src/lib/contracts/garments.ts,…` is "lib/contracts/garments (ts)";
`src/ui/**\/*.tsx` is "ui (tsx)". The first path names the entry.
*/
function nameOf(scope: string): string {
  const [positive = ""] = scope.split(",", 1);
  const extension = positive.slice(positive.lastIndexOf(".") + 1);
  const [head = ""] = positive.split("/**", 1);
  const base = head === positive ? head.replace(/\.[^./]+$/u, "") : head;
  return `${base.replace(/^src\//u, "")} (${extension})`;
}

function slugOf(name: string): string {
  return name
    .replaceAll(/[^A-Za-z0-9]+/gu, "-")
    .replaceAll(/^-|-$/gu, "")
    .toLowerCase();
}

export function shardsOf(mutate: readonly string[]): Shard[] {
  return mutate.map((entry) => {
    const name = nameOf(entry);
    return { mutate: entry, name, slug: slugOf(name) };
  });
}

/**
Whether `file` is in the entry's scope: a positive path matches it and no
`!` path does.
*/
export function isInScope(shard: Shard, file: string): boolean {
  const paths = shard.mutate.split(",");
  const negated = paths.filter((path) => path.startsWith("!"));
  return (
    paths.some(
      (path) => !path.startsWith("!") && nodePath.matchesGlob(file, path),
    ) && negated.every((path) => !nodePath.matchesGlob(file, path.slice(1)))
  );
}

export interface Graph {
  /**
  Each cruised file's local imports, resolved, type-only ones left out.
  */
  readonly imports: ReadonlyMap<string, readonly string[]>;
  /**
  The files whose imports the graph does not hold in full: a local import
  that did not resolve, an `import(…)` of a computed path, an
  `import.meta.glob` that loads modules rather than reading text.
  */
  readonly unseen: ReadonlySet<string>;
}

export interface Change {
  readonly path: string;
  readonly deleted: boolean;
}

/**
The status letters `git diff --name-status --no-renames` prints.
*/
const STATUS = /^[ACDMTUXB]$/u;

/**
`git diff -z --name-status --no-renames`: a status letter, a NUL, the path
as its bytes are, a NUL. Anything else throws, and the workflow then runs
every shard.
*/
export function parseNameStatus(text: string): Change[] {
  if (text === "") return [];
  if (!text.endsWith("\0")) {
    throw new Error("git diff -z output does not end in NUL");
  }
  const fields = text.slice(0, -1).split("\0");
  const changes: Change[] = [];
  for (let index = 0; index < fields.length; index += 2) {
    const status = fields[index] ?? "";
    if (!STATUS.test(status)) {
      throw new Error(`git diff -z status "${status}" is not one git prints`);
    }
    const path = fields[index + 1];
    if (path === undefined) {
      throw new Error(`git diff -z record "${status}" has no path`);
    }
    changes.push({ path, deleted: status === "D" });
  }
  return changes;
}

export type Selection =
  | { readonly kind: "all"; readonly reason: string }
  | {
      readonly kind: "some";
      /**
      Each kept shard's name, with why it was kept.
      */
      readonly kept: ReadonlyMap<string, string>;
    };

/**
What every shard runs on: the toolchain, the test harness and its setup,
the databases the worker tests migrate, the selector and the scripts that
find its reports. A change to
any of them keeps every shard.
*/
const EVERY_SHARD: readonly RegExp[] = [
  /^package(?:-lock)?\.json$/u,
  /^\.npmrc$/u,
  /^mise\.toml$/u,
  /^stryker\.conf\.json$/u,
  /^vitest[^/]*\.config[^/]*$/u,
  /^vite\.config\.ts$/u,
  /^tsconfig[^/]*$/u,
  /^wrangler\.jsonc?$/u,
  /^worker-configuration\.d\.ts$/u,
  /^\.github\/workflows\//u,
  /^public\//u,
  /^src\/db\/migrations\//u,
  /^scripts\/mutation-shards(?:\.ts$|\/)/u,
  /^scripts\/main-mutation-(?:reports|runs)\.sh$/u,
];

const TEST = /^test\/.*\.test\.tsx?$/u;
const CRUISED = /^(?:src|test|e2e|scripts)\//u;
const CODE = /\.(?:[cm]?[jt]s|[jt]sx)$/u;

/**
Every file reachable from `starts` along `edges`, the starts included.
*/
function reach(
  starts: Iterable<string>,
  edges: ReadonlyMap<string, readonly string[]>,
): Set<string> {
  const seen = new Set(starts);
  const queue = [...seen];
  for (let file = queue.pop(); file !== undefined; file = queue.pop()) {
    const nexts = edges.get(file) ?? [];
    for (const next of nexts) {
      if (seen.has(next)) {
        continue;
      }

      seen.add(next);
      queue.push(next);
    }
  }
  return seen;
}

function importersOf(graph: Graph): Map<string, string[]> {
  const importers = new Map<string, string[]>();
  for (const [file, imports] of graph.imports) {
    for (const imported of imports) {
      const known = importers.get(imported);
      if (known === undefined) importers.set(imported, [file]);
      else known.push(file);
    }
  }
  return importers;
}

/**
Each shard's name, with the test files main's report for it lists as
covering or killing a mutant. A shard missing from it had no report to read.
*/
export type Coverage = ReadonlyMap<string, ReadonlySet<string>>;

/**
Why every shard runs for this change, or undefined when the graph and the
reports can say which do.
*/
function everyShardBecause(change: Change, graph: Graph): string | undefined {
  const { path } = change;
  if (path.startsWith('"')) return `${path} is a path git quoted`;
  if (EVERY_SHARD.some((pattern) => pattern.test(path))) {
    return `${path} is what every shard runs on`;
  }
  if (TEST.test(path)) return undefined;
  if (path.startsWith("test/")) {
    return `${path} supports the tests, outside the import graph`;
  }
  const isUnread =
    !change.deleted && CRUISED.test(path) && !graph.imports.has(path);
  return isUnread && (path.startsWith("src/") || CODE.test(path))
    ? `${path} is not in the import graph`
    : undefined;
}

type Reason = readonly [Shard, string];

/**
(b): the shards whose report lists this test as covering a mutant.
*/
function coveredBy(
  shards: readonly Shard[],
  coverage: Coverage,
  test: string,
): Reason[] {
  return shards
    .filter((shard) => coverage.get(shard.name)?.has(test) === true)
    .map((shard) => [shard, `${test} covers its mutants`]);
}

/**
(c): the shards with a file that imports this one, through any chain. A
file whose imports are unseen may import it.
*/
function importedBy(
  shards: readonly Shard[],
  graph: Graph,
  importers: ReadonlyMap<string, readonly string[]>,
  path: string,
): Reason[] {
  const dependents = [...reach([path, ...graph.unseen], importers)];
  return dependents.flatMap((file) =>
    shards
      .filter((shard) => isInScope(shard, file))
      .map((shard): Reason => [shard, `${file} imports ${path}`]),
  );
}

function reasonsFor(
  change: Change,
  context: {
    readonly shards: readonly Shard[];
    readonly graph: Graph;
    readonly coverage: Coverage;
    readonly importers: ReadonlyMap<string, readonly string[]>;
  },
): Reason[] {
  const { shards, graph, coverage, importers } = context;
  const { path } = change;
  const owners = shards
    .filter((shard) => isInScope(shard, path))
    .map((shard): Reason => [shard, `${path} changed`]);
  if (TEST.test(path)) return [...owners, ...coveredBy(shards, coverage, path)];
  if (change.deleted || owners.length > 0) return owners;
  return importedBy(shards, graph, importers, path);
}

export function selectShards(
  shards: readonly Shard[],
  changes: readonly Change[],
  graph: Graph,
  coverage: Coverage,
): Selection {
  for (const change of changes) {
    const reason = everyShardBecause(change, graph);
    if (reason !== undefined) return { kind: "all", reason };
  }
  const kept = new Map<string, string>();
  for (const shard of shards) {
    if (!coverage.has(shard.name)) kept.set(shard.name, "no report to read");
  }
  const context = { shards, graph, coverage, importers: importersOf(graph) };
  for (const change of changes) {
    for (const [shard, why] of reasonsFor(change, context)) {
      if (!kept.has(shard.name)) kept.set(shard.name, why);
    }
  }
  return { kind: "some", kept };
}

export function keptShards(
  shards: readonly Shard[],
  selection: Selection,
): Shard[] {
  return selection.kind === "all"
    ? [...shards]
    : shards.filter((shard) => selection.kept.has(shard.name));
}
