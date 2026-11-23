/**
 * Which Mutation shards a PR runs (design 259). One shard per entry of
 * `stryker.conf.json`'s `mutate` array; a PR keeps the ones its diff can
 * affect, and a push to `main` keeps them all.
 *
 * A shard is kept when (a) a changed file is in its scope, (b) a file in
 * its scope transitively imports a changed file, or (c) a changed test
 * transitively imports a file in its scope. Every shard is kept when the
 * diff touches what every shard runs on, or when the graph cannot answer.
 *
 * Pure: the changed files and the import graph in, the shards out. The
 * graph is read in `graph.ts` and the CLI is `scripts/mutation-shards.ts`.
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
`git diff --name-status --no-renames`: a status letter, a tab, the path.
*/
export function parseNameStatus(text: string): Change[] {
  return text
    .split("\n")
    .filter((line) => line.includes("\t"))
    .map((line) => {
      const [status = "", path = ""] = line.split("\t", 2);
      return { path, deleted: status === "D" };
    });
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
the databases the worker tests migrate, the selector itself. A change to
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
Why every shard runs for this change, or undefined when the graph can say
which do.
*/
function everyShardBecause(change: Change, graph: Graph): string | undefined {
  const { path } = change;
  if (EVERY_SHARD.some((pattern) => pattern.test(path))) {
    return `${path} is what every shard runs on`;
  }
  if (path.startsWith("test/") && !TEST.test(path)) {
    return `${path} supports the tests, outside the import graph`;
  }
  if (change.deleted) {
    return TEST.test(path)
      ? `${path} was deleted, so what it reached is unknown`
      : undefined;
  }
  const isUnread = CRUISED.test(path) && !graph.imports.has(path);
  return isUnread && (path.startsWith("src/") || CODE.test(path))
    ? `${path} is not in the import graph`
    : undefined;
}

export function selectShards(
  shards: readonly Shard[],
  changes: readonly Change[],
  graph: Graph,
): Selection {
  for (const change of changes) {
    const reason = everyShardBecause(change, graph);
    if (reason !== undefined) return { kind: "all", reason };
  }
  const kept = new Map<string, string>();
  const keep = (files: Iterable<string>, why: (file: string) => string) => {
    for (const file of files) {
      for (const shard of shards) {
        if (!kept.has(shard.name) && isInScope(shard, file)) {
          kept.set(shard.name, why(file));
        }
      }
    }
  };
  const importers = importersOf(graph);
  for (const { path, deleted } of changes) {
    keep([path], () => `${path} changed`);
    if (deleted || !graph.imports.has(path)) continue;
    if (TEST.test(path)) {
      const reached = reach([path], graph.imports);
      const blind = [...reached].find((file) => graph.unseen.has(file));
      if (blind !== undefined) {
        return {
          kind: "all",
          reason: `${path} reaches ${blind}, whose imports the graph cannot follow`,
        };
      }
      keep(reached, (file) => `${path} tests ${file}`);
    } else {
      // A file whose imports are unseen may import this one.
      const dependents = reach([path, ...graph.unseen], importers);
      keep(dependents, (file) => `${file} imports ${path}`);
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
