import { describe, expect, it } from "vitest";

import {
  codeOnly,
  isInstrumented,
  repoPath,
  withoutComments,
} from "./source-text";

/**
 * Every screen must stamp `html[data-hydrated="true"]`, and this is the
 * only thing that can say so.
 *
 * `useHydrated` writes that attribute and exactly two components call it:
 * `Layout` and `Page`. Every e2e spec waits on it before driving a
 * controlled input, because hydration resets component state and a fill
 * that lands first is silently discarded.
 *
 * **The rule was implicit and that is how it broke.** Onboarding is a flow
 * rather than a tab, so O1, O3 and P3 wear `Page` with no `Layout` — and
 * when the signal lived inside `Layout` alone, the three screens that are
 * *entirely* controlled forms were the three without it. Nothing failed at
 * build time, nothing failed in a unit test; the onboarding demo timed out
 * waiting for an attribute that was never coming, which is a long way from
 * the cause (D-53).
 *
 * A screen that renders neither shell has the same hole, so this asks the
 * question statically. Routes cannot be imported — `createFileRoute` pulls
 * TanStack Start's virtual entries — so the check reads their source, and
 * follows the components they render one file at a time until it finds a
 * shell or runs out of local files to look in.
 */

const sources: Record<string, string> = import.meta.glob(
  [
    "../../src/routes/**/*.tsx",
    "../../src/modules/**/*.tsx",
    "../../src/ui/**/*.tsx",
  ],
  { query: "?raw", import: "default", eager: true },
);

const byPath = new Map(
  Object.entries(sources).map(([globPath, source]) => [
    repoPath(globPath),
    source,
  ]),
);

/**
 * A `component:` property, and not `errorComponent:` or `shellComponent:`.
 */
const RENDERS_A_SCREEN = /(?:^|[\s,{])component:/u;

/**
 * `<Layout` or `<Page`, and not `<PageHeader`.
 */
const WEARS_A_SHELL = /<(?:Layout|Page)[\s/>]/u;

/**
 * Every `<Capitalised` element name the source uses.
 */
const JSX_ELEMENT = /<(?<name>[A-Z]\w*)/gu;

/**
 * An import's brace clause and its specifier.
 */
const IMPORT = /import\s[^;]*?from\s*["'](?<specifier>[^"']+)["']/gu;

/**
 * Resolve `"./x"` or `"../y/z"` against the importer, with no `node:path`:
 * the workers pool sandboxes the filesystem, so this is string work.
 */
function resolveSpecifier(importer: string, specifier: string): string {
  const segments = importer.split("/").slice(0, -1);
  for (const part of specifier.split("/")) {
    if (part === "..") segments.pop();
    else if (part !== ".") segments.push(part);
  }
  const base = segments.join("/");
  return (
    [`${base}.tsx`, `${base}/index.tsx`].find((candidate) =>
      byPath.has(candidate),
    ) ?? ""
  );
}

/**
 * The local files a source renders components from.
 *
 * Import *graph* reachability would be far too generous — every route
 * reaches `Layout` through the `ui` barrel whether it renders one or not.
 * So a file counts only when the source both imports from it and uses one
 * of the names it imported as a JSX element.
 */
function renderedFrom(path: string): string[] {
  const source = byPath.get(path) ?? "";
  // Built with a loop rather than `[...matchAll()].map()` or the iterator
  // helpers: the spread form trips `unicorn/prefer-iterator-to-array-at-end`,
  // and `.toArray()` does not exist in this project's TS lib, so reaching
  // for it turns one lint fix into thirty `any` errors downstream.
  const used = new Set<string>();
  for (const match of codeOnly(source).matchAll(JSX_ELEMENT)) {
    used.add(match.groups?.name ?? "");
  }
  // Imports are read from source with its strings intact: `codeOnly` blanks
  // every literal, which takes the specifier with it. That bug made this
  // function return nothing at all, so the two auth routes failed and the
  // exemption below "passed" without proving anything.
  const reached: string[] = [];
  for (const match of withoutComments(source).matchAll(IMPORT)) {
    const specifier = match.groups?.specifier ?? "";
    if (!specifier.startsWith(".")) continue;
    const names = match[0]
      .replaceAll(/[{}]/gu, " ")
      .split(/[\s,]+/u)
      .map((name) => name.trim());
    if (names.every((name) => !used.has(name))) continue;
    const resolved = resolveSpecifier(path, specifier);
    if (resolved !== "") reached.push(resolved);
  }
  return reached;
}

/**
 * Does this file, or anything it renders, wear a shell?
 */
function hasShell(path: string, seen = new Set<string>()): boolean {
  if (seen.has(path)) return false;
  seen.add(path);
  if (WEARS_A_SHELL.test(codeOnly(byPath.get(path) ?? ""))) return true;
  return renderedFrom(path).some((next) => hasShell(next, seen));
}

const screens: string[] = [];
for (const [path, source] of byPath) {
  if (!path.startsWith("src/routes/")) continue;
  // Stryker rewrites source in its sandbox, and Vite's `?raw` inlines the
  // rewrite — so a mutation run would scan its own instrumentation.
  if (isInstrumented(source)) continue;
  if (!RENDERS_A_SCREEN.test(codeOnly(source))) continue;
  screens.push(path);
}

describe("every screen stamps the hydration signal", () => {
  it("finds the screens", () => {
    // A resolution bug that matched nothing would pass every case below
    // without asserting anything. `src/routes/` holds more than 20 screens.
    expect(screens.length).toBeGreaterThan(20);
  });

  it.each(screens)("%s renders Layout or Page", (path) => {
    expect(hasShell(path)).toBe(true);
  });

  it("would notice a screen that wears neither", () => {
    // The check above only ever says "true", so on its own it cannot tell
    // a working scan from one that returns true for everything. This is
    // the negative case: `StravaCallbackResult` was the one real gap this
    // test found, and before it wore `Page` it looked exactly like this.
    const bare = "src/modules/runs/components/StravaCallbackResult.tsx";
    expect(byPath.has(bare)).toBe(true);
    expect(WEARS_A_SHELL.test('<div className="mx-auto flex">')).toBe(false);
    expect(WEARS_A_SHELL.test("<PageHeader title={x} />")).toBe(false);
    expect(WEARS_A_SHELL.test('<Page width="narrow">')).toBe(true);
  });
});
