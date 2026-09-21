import { describe, expect, it } from "vitest";

import {
  codeOnly,
  isInstrumented,
  repoPath,
  withoutComments,
} from "./source-text";

/**
 * Rule 04 · **one `<h1>` per screen**, across all 33 routes.
 *
 * *"A screen with no heading is a bug"* — and two of them are: a screen
 * with none announces nothing when a reader jumps by heading, and a screen
 * with two makes "the heading" ambiguous for the whole page.
 *
 * **The audit found the app already compliant**, which is worth saying
 * plainly: every route carries exactly one heading source today, and this
 * is the test that keeps it that way rather than a fix for anything. Two
 * spellings are in use and both are correct — `<Page title>`, which
 * renders the `h1` itself, and a hand-written `<h1>` in the component the
 * route renders. Routes that own a heading through neither would have to
 * invent a third.
 *
 * Routes cannot be imported — `createFileRoute` pulls TanStack Start's
 * virtual entries — so this reads their source and follows what they
 * render, exactly as `routes-stamp-hydration.test.ts` does for the
 * hydration signal. The two walk the same graph for different reasons and
 * share the scanner in `source-text.ts`.
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

const RENDERS_A_SCREEN = /(?:^|[\s,{])component:/u;
const JSX_ELEMENT = /<(?<name>[A-Z]\w*)/gu;
const IMPORT = /import\s[^;]*?from\s*["'](?<specifier>[^"']+)["']/gu;

/**
 * An `<h1`, and a `<Page` whose props include a `title` — the two ways a
 * screen can own its heading.
 *
 * `Page` is counted at the call site rather than by following into it,
 * because `Page` renders its `h1` only when it is given a title: run
 * detail wears `<Page>` with none and lets `RunDetail` write the heading.
 * Following the import would count that screen twice and a titleless one
 * once, both wrong.
 */
const OWN_H1 = /<h1[\s>]/gu;
const PAGE_WITH_TITLE = /<Page\b[^>]*\btitle=/gsu;

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

function renderedFrom(path: string): string[] {
  const source = byPath.get(path) ?? "";
  const used = new Set<string>();
  for (const match of codeOnly(source).matchAll(JSX_ELEMENT)) {
    used.add(match.groups?.name ?? "");
  }
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
 * How many times `pattern` matches — counted by splitting on it rather
 * than by collecting the matches.
 *
 * **Neither `[...source.matchAll(p)]` nor `.toArray()`**, and the reason
 * is recorded in CLAUDE.md: `unicorn/prefer-iterator-to-array` rejects the
 * spread and asks for `Iterator#toArray()`, which this project's TS lib
 * does not have — so taking the rule's advice turns one lint error into
 * thirty `any` errors downstream. Three fix passes went round that loop on
 * this file. A `split` produces `n + 1` pieces for `n` matches and needs
 * no iterator at all, so there is nothing for either rule to object to.
 *
 * Both patterns are global and capture nothing, which is what makes the
 * arithmetic exact: a capture group would put its own text into the
 * pieces.
 */
function countOf(source: string, pattern: RegExp): number {
  return source.split(pattern).length - 1;
}

/**
 * Every heading this screen renders, named by where it is written, so a
 * failure says which file to open.
 */
function headings(path: string, seen = new Set<string>()): string[] {
  if (seen.has(path)) return [];
  seen.add(path);
  const code = codeOnly(byPath.get(path) ?? "");
  const found: string[] = [
    ...Array.from({ length: countOf(code, OWN_H1) }, () => `${path} <h1>`),
    // `Page` is followed *into* for nothing, so a bare `<Page>` adds
    // nothing here — which is what lets run detail pass with its own h1.
    ...Array.from(
      { length: countOf(code, PAGE_WITH_TITLE) },
      () => `${path} <Page title>`,
    ),
  ];
  for (const next of renderedFrom(path)) found.push(...headings(next, seen));
  return found;
}

const screens: string[] = [];
for (const [path, source] of byPath) {
  if (!path.startsWith("src/routes/")) continue;
  // Stryker rewrites source in its sandbox and Vite's `?raw` inlines the
  // rewrite, so a mutation run would scan its own instrumentation.
  if (isInstrumented(source)) continue;
  if (!RENDERS_A_SCREEN.test(codeOnly(source))) continue;
  screens.push(path);
}

describe("04 · one h1 per screen", () => {
  it("finds the screens, so nothing below is vacuous", () => {
    // A resolution bug that matched nothing would pass every case below
    // while proving nothing at all.
    expect(screens.length).toBeGreaterThan(25);
  });

  it.each(screens)("%s renders exactly one heading", (path) => {
    expect(headings(path)).toHaveLength(1);
  });

  it("would notice a screen with two, and one with none", () => {
    // Both failure modes, against the scanner itself rather than against a
    // route — the cases above can only ever say "one", so on their own
    // they cannot tell a working count from one that always returns a
    // single element.
    expect(countOf(codeOnly("<h1>a</h1><h1>b</h1>"), OWN_H1)).toBe(2);
    expect(countOf(codeOnly('<Page width="narrow">'), PAGE_WITH_TITLE)).toBe(0);
    expect(
      countOf(codeOnly('<Page title={x} width="narrow">'), PAGE_WITH_TITLE),
    ).toBe(1);
    // A heading written in a comment is prose about a heading.
    expect(countOf(codeOnly("// renders an <h1> here"), OWN_H1)).toBe(0);
  });
});
