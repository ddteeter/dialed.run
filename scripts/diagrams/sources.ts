/**
 * Reads the facts the diagram generator draws from (design 229): every
 * source under `src`, the imports between them as dependency-cruiser
 * resolves them, and what `syntax.ts` reads from their syntax.
 *
 * dependency-cruiser is the tool that enforces the module boundaries at the
 * commit gate, so the diagram and the gate agree on what an import is: it
 * follows every form (static, re-export, bare, dynamic, type-only) and the
 * tsconfig aliases. This file only calls it and the filesystem; what the
 * facts mean is decided in `structure.ts`, which is tested.
 */
import { readFileSync } from "node:fs";

import { cruise } from "dependency-cruiser";
import extractTSConfig from "dependency-cruiser/config-utl/extract-ts-config";

import type { ImportEdge, SourceFacts, UnreadImport } from "./structure";
import { fileSyntax, mainEntries } from "./syntax";

const SOURCE = /^src\/.*\.tsx?$/u;
// A package specifier: `zod`, `@scope/name`. An alias (`@/…`, `#/…`) is
// not one, so an alias the resolver cannot follow is reported.
const PACKAGE = /^(?:@[\w.-]+\/)?[\w.-]/u;

interface Dependency {
  readonly module: string;
  readonly resolved: string;
  readonly couldNotResolve: boolean;
}

interface Module {
  readonly source: string;
  readonly dependencies: readonly Dependency[];
}

async function cruiseSources(): Promise<readonly Module[]> {
  const result = await cruise(
    ["src"],
    {
      tsPreCompilationDeps: true,
      tsConfig: { fileName: "tsconfig.json" },
      doNotFollow: { path: "node_modules" },
    },
    undefined,
    { tsConfig: extractTSConfig("tsconfig.json") },
  );
  if (typeof result.output === "string") {
    throw new TypeError("dependency-cruiser returned text, not modules");
  }
  return result.output.modules;
}

function edgesOf(modules: readonly Module[]): {
  imports: ImportEdge[];
  unread: UnreadImport[];
} {
  const imports: ImportEdge[] = [];
  const unread: UnreadImport[] = [];
  for (const { source, dependencies } of modules) {
    if (!SOURCE.test(source)) continue;
    for (const dependency of dependencies) {
      if (dependency.couldNotResolve) {
        if (!PACKAGE.test(dependency.module)) {
          unread.push({ from: source, text: dependency.module });
        }
      } else if (SOURCE.test(dependency.resolved)) {
        imports.push({ from: source, to: dependency.resolved });
      }
    }
  }
  return { imports, unread };
}

/**
Everything `generateStructure` needs to know about the sources.
*/
export async function readSources(main: string): Promise<SourceFacts> {
  const modules = await cruiseSources();
  const paths = modules
    .map((module) => module.source)
    .filter((path) => SOURCE.test(path))
    .toSorted((a, b) => a.localeCompare(b));
  const { imports, unread } = edgesOf(modules);
  const serverFunctionFiles: string[] = [];
  for (const path of paths) {
    const syntax = fileSyntax(path, readFileSync(path, "utf8"));
    if (syntax.createsServerFunction) serverFunctionFiles.push(path);
    for (const text of syntax.computedImports)
      unread.push({ from: path, text });
  }
  return {
    paths,
    imports,
    unread,
    serverFunctionFiles,
    mainEntries: paths.includes(main)
      ? mainEntries(main, readFileSync(main, "utf8"))
      : [],
  };
}
