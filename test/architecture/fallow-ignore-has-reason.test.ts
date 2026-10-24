import { describe, expect, it } from "vitest";

import { repoPath } from "./source-text";

/**
 * **Every `fallow-ignore` says why, on the same line.**
 *
 * A clone suppression is for a _rhyme_ — two stretches alike in shape that
 * are not the same idea — and the reason is what lets a reviewer tell a
 * rhyme from a clone someone would rather not fix. The convention is
 * `// fallow-ignore-next-line <kind> -- <reason>`; `fallow suppressions`
 * lists them all, and this keeps every entry in that list reviewable.
 */

const sources: Record<string, string> = import.meta.glob(
  ["../../src/**/*.{ts,tsx}", "../../test/**/*.{ts,tsx}"],
  { query: "?raw", import: "default", eager: true },
);

/**
 * A directive is a line comment that starts its line — so prose about
 * `fallow-ignore` in a doc comment, and the sample strings below, are not.
 */
const DIRECTIVE = /^[ \t]*\/\/ ?fallow-ignore.*$/gmu;
const WITH_REASON = /fallow-ignore-next-line [a-z-]+ -- \S.{19,}/u;

function unexplainedIn(path: string, source: string): string[] {
  return Array.from(source.matchAll(DIRECTIVE), (match) => match[0].trim())
    .filter((line) => !WITH_REASON.test(line))
    .map((line) => `${path}: ${line}`);
}

const files = Object.entries(sources).map(
  ([globPath, source]) => [repoPath(globPath), source] as const,
);

describe("fallow-ignore carries a reason", () => {
  it("found suppressions to check, so nothing below is vacuous", () => {
    expect(
      files.flatMap(([, source]) =>
        Array.from(source.matchAll(DIRECTIVE), (match) => match[0]),
      ).length,
    ).toBeGreaterThan(10);
  });

  it("every suppression in src/ and test/ explains itself", () => {
    expect(
      files.flatMap(([path, source]) => unexplainedIn(path, source)),
      "write `// fallow-ignore-next-line <kind> -- <why these are a rhyme, not a copy>`",
    ).toEqual([]);
  });

  it("would catch a bare or token-reason directive, and not prose about one", () => {
    expect(
      unexplainedIn("a.ts", " * a `// fallow-ignore` is for a rhyme\n"),
    ).toEqual([]);
    expect(
      unexplainedIn("a.ts", "// fallow-ignore-next-line code-duplication\n"),
    ).toHaveLength(1);
    expect(
      unexplainedIn(
        "a.ts",
        "// fallow-ignore-next-line code-duplication -- same\n",
      ),
    ).toHaveLength(1);
    expect(
      unexplainedIn(
        "a.ts",
        "// fallow-ignore-next-line code-duplication -- two routes of one shape by mandate\n",
      ),
    ).toEqual([]);
  });
});
