import { describe, expect, it } from "vitest";

import { isInstrumented, repoPath, withoutComments } from "./source-text";

/**
 * **Text on an accent is accent ink** (T2 rule 02; design 185).
 *
 * "Pink, teal and hi-viz surfaces carry #0B0B0E text in both modes." The
 * role that says so is `--accent-ink`, which no column redefines. `--ink`
 * says it only on paper: on a dark page it is chalk, and chalk on hi-viz is
 * 1.1:1. Nothing else fails when a class string pairs the two, because the
 * light theme looks right, so this reads every class string for an accent
 * fill beside `text-ink`.
 *
 * **What it does not read**: an accent fill whose text colour comes from a
 * parent, or from a second string joined in at runtime. Those are stated
 * gaps; design 185's sweep found none.
 */
const sources: Record<string, string> = import.meta.glob(
  [
    "../../src/ui/**/*.{ts,tsx}",
    "../../src/modules/**/*.{ts,tsx}",
    "../../src/routes/**/*.tsx",
  ],
  { query: "?raw", import: "default", eager: true },
);

/**
 * One string literal: a quoted class list or a template's text.
 */
const STRING = /"[^"\n]*"|`[^`]*`/gu;

/**
 * A fill that is an accent surface, behind any variant.
 */
const ACCENT_FILL =
  /^(?:[\w-]+:)*bg-(?:action|action-hover|teal|failure|hi-viz)$/u;

/**
 * `text-ink`, behind any variant — not `text-ink-hover` or `text-accent-ink`.
 */
const GROUND_INK = /^(?:[\w-]+:)*text-ink$/u;

const files = Object.entries(sources)
  .map(([globPath, source]) => [repoPath(globPath), source] as const)
  .filter(([, source]) => !isInstrumented(source));

function groundInkOnAccents(path: string, source: string): string[] {
  return (withoutComments(source).match(STRING) ?? [])
    .filter((literal) => {
      const tokens = literal.slice(1, -1).split(/\s+/u);
      return (
        tokens.some((token) => ACCENT_FILL.test(token)) &&
        tokens.some((token) => GROUND_INK.test(token))
      );
    })
    .map((literal) => `${path}: ${literal}`);
}

describe("text on an accent is accent ink", () => {
  it("found the source, so nothing below is vacuous", () => {
    expect(files.length).toBeGreaterThan(40);
    expect(files.some(([, source]) => source.includes("text-accent-ink"))).toBe(
      true,
    );
  });

  it("pairs no accent fill with the ground's ink", () => {
    expect(
      files.flatMap(([path, source]) => groundInkOnAccents(path, source)),
    ).toEqual([]);
  });

  it("would catch one, behind a variant or in a template", () => {
    expect(
      groundInkOnAccents("src/ui/X.tsx", 'className="bg-action text-ink"'),
    ).toEqual(['src/ui/X.tsx: "bg-action text-ink"']);
    expect(
      groundInkOnAccents(
        "src/ui/X.tsx",
        "const C = `p-4 hover:bg-action-hover ${x} text-ink`;",
      ),
    ).toHaveLength(1);
    expect(
      groundInkOnAccents("src/ui/X.tsx", '"bg-failure px-3 desk:text-ink"'),
    ).toHaveLength(1);
  });

  it("leaves accent ink, other inks and plain grounds alone", () => {
    expect(
      groundInkOnAccents(
        "src/ui/X.tsx",
        [
          '"bg-action text-accent-ink"',
          '"bg-teal hover:bg-ink-hover"',
          '"bg-ground text-ink"',
          '"bg-ink text-ground"',
          '"border-action text-ink"',
        ].join("\n"),
      ),
    ).toEqual([]);
  });
});
