/**
 * The import graph `select.ts` decides from (design 259): every file under
 * `src`, `test`, `e2e` and `scripts`, the local imports between them as
 * dependency-cruiser resolves them (the same resolver the commit gate's
 * boundary rules use, tsconfig aliases included), and the files whose
 * imports it cannot see in full.
 *
 * Type-only imports are left out: they run nothing, so they cannot change
 * whether a mutant is killed.
 */
import { readFileSync } from "node:fs";

import { cruise, type IModule } from "dependency-cruiser";
import extractTSConfig from "dependency-cruiser/config-utl/extract-ts-config";
import ts from "typescript";

import { fileSyntax, parse } from "../diagrams/syntax";
import type { Graph } from "./select";

const CODE = /\.(?:[cm]?[jt]s|[jt]sx)$/u;
// A relative path or a tsconfig alias (`#/…`, `@/…`): a file of ours. A
// package (`zod`, `cloudflare:workers`) that does not resolve is not.
const OURS = /^(?:\.{1,2}\/|[#@]\/)/u;

async function cruiseOurFiles(): Promise<readonly IModule[]> {
  const { output } = await cruise(
    ["src", "test", "e2e", "scripts"],
    {
      doNotFollow: { path: "node_modules" },
      tsConfig: { fileName: "tsconfig.json" },
      tsPreCompilationDeps: false,
    },
    undefined,
    { tsConfig: extractTSConfig("tsconfig.json") },
  );
  if (typeof output === "string") {
    throw new TypeError("expected the cruise as modules, got text");
  }
  return output.modules;
}

/**
Whether a file calls `import.meta.glob` for modules, not for `?raw` text.
Its keys are files the resolver never sees, loaded and run.
*/
export function hasModuleGlob(path: string, text: string): boolean {
  const file = parse(path, text);
  let isFound = false;
  const visit = (node: ts.Node): void => {
    if (
      ts.isCallExpression(node) &&
      node.expression.getText(file) === "import.meta.glob" &&
      !node.getText(file).includes('"?raw"')
    ) {
      isFound = true;
    }
    ts.forEachChild(node, visit);
  };
  visit(file);
  return isFound;
}

/**
Whether a file's own syntax hides imports from the resolver.
*/
function doesHideImports(path: string): boolean {
  if (!CODE.test(path)) return false;
  const text = readFileSync(path, "utf8");
  const isSuspect =
    text.includes("import(") || text.includes("import.meta.glob");
  return (
    isSuspect &&
    (fileSyntax(path, text).computedImports.length > 0 ||
      hasModuleGlob(path, text))
  );
}

export async function readGraph(): Promise<Graph> {
  const modules = await cruiseOurFiles();
  const imports = new Map<string, string[]>();
  const unseen = new Set<string>();
  for (const { source, dependencies } of modules) {
    if (source.startsWith("node_modules/")) continue;
    const local: string[] = [];
    for (const dependency of dependencies) {
      if (dependency.couldNotResolve) {
        if (OURS.test(dependency.module)) unseen.add(source);
      } else if (!dependency.resolved.startsWith("node_modules/")) {
        local.push(dependency.resolved);
      }
    }
    imports.set(source, local);
    if (doesHideImports(source)) unseen.add(source);
  }
  return { imports, unseen };
}
