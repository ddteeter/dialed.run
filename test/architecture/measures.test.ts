import { describe, expect, it } from "vitest";

import { isInstrumented, repoPath, withoutComments } from "./source-text";

/**
 * DS4's two rules, asked of every class string in the app.
 *
 * *"Two thresholds, three layouts. **Never a third breakpoint.**"* and
 * *"**Nothing pins a width that is not in MEASURE.**"* Both are properties
 * of the whole set rather than of any one component, so both are asked of
 * the source — the same instrument `targets-and-focus` uses, for the same
 * reason.
 *
 * **And a class Tailwind does not know is dropped in silence.** Task 113
 * cleared `--breakpoint-*`, so `sm:`, `md:` and `lg:` no longer compile to
 * anything at all: a lane reaching for one gets no error, no warning, an
 * element that never responds, and a green suite. That is the failure this
 * file exists to make loud, and it is why the check is "no other variant
 * exists" rather than "the two we want are present".
 *
 * Scanned over **string literals only**, with comments stripped first —
 * `withoutComments` and not `codeOnly`, which blanks the string bodies
 * that are the whole subject here.
 * `ui/Mono.tsx` keys a lookup on `sm`/`md`/`lg` and two files discuss
 * `max-w-*` in prose; a scan of raw source finds all five and none of them
 * is a class.
 */

const sources: Record<string, string> = import.meta.glob(
  ["../../src/**/*.tsx", "../../src/**/*.ts"],
  { query: "?raw", import: "default", eager: true },
);

/**
 * Every quoted string in the code — double-quoted and backticked, which is
 * every spelling a `className` uses in this repo.
 *
 * Deliberately not parsed as JSX: a class list reaches an element through
 * a `const`, a template hole or a lookup table as often as it is written
 * at the site, and all four are string literals.
 */
const STRING = /"([^"\n]*)"|`([^`]*)`/gu;

function literalsIn(code: string): string[] {
  return Array.from(
    code.matchAll(STRING),
    (match) => match[1] ?? match[2] ?? "",
  );
}

interface Found {
  readonly path: string;
  readonly literal: string;
  readonly token: string;
}

function scan(pattern: RegExp): Found[] {
  const found: Found[] = [];
  for (const [globPath, source] of Object.entries(sources)) {
    // Stryker rewrites source in its sandbox and Vite's `?raw` inlines the
    // rewrite, so a mutation run would scan its own instrumentation.
    if (isInstrumented(source)) continue;
    const path = repoPath(globPath);
    const literals = literalsIn(withoutComments(source));
    for (const literal of literals) {
      for (const match of literal.matchAll(pattern)) {
        found.push({ path, literal, token: match[0].trim() });
      }
    }
  }
  return found;
}

/**
 * A responsive variant: a token followed by `:` and the start of a
 * utility, at the head of a class or after whitespace.
 */
const OTHER_BREAKPOINT =
  /(?:^|\s)(?:sm|md|lg|xl|2xl|min-\[[^\]]*\]|max-\[[^\]]*\]):(?=[a-z[-])/gu;

/**
 * `max-w-…` and any arbitrary width, which are the two ways to pin one.
 */
const PINNED_WIDTH = /(?:^|\s)(?:max-)?w-\[[^\]]*\]|(?:^|\s)max-w-[\w./-]+/gu;

/**
 * The widths a class is allowed to name.
 *
 * The three MEASURE containers, plus the two that pin nothing: `none`
 * removes a cap and `full` is the parent's width, whatever that is.
 */
const ALLOWED_WIDTHS = new Set([
  "max-w-panel",
  "max-w-column",
  "max-w-page",
  "max-w-none",
  "max-w-full",
]);

/**
 * The two scans, over a string rather than over the repo, so each case
 * below can show the shape it is looking for.
 *
 * **`Array.from`, never a spread and never `.toArray()`.**
 * `unicorn/prefer-iterator-to-array` rejects the spread and asks for
 * `Iterator#toArray()`, which this project's TS lib does not have — taking
 * its advice turns one lint error into a pile of `any` ones. CLAUDE.md
 * records the three fix passes that went round that loop.
 */
function variant(text: string): string[] {
  return Array.from(text.matchAll(OTHER_BREAKPOINT), (match) =>
    match[0].trim(),
  );
}

function pinned(text: string): string[] {
  return Array.from(text.matchAll(PINNED_WIDTH), (match) =>
    match[0].trim(),
  ).filter((token) => !ALLOWED_WIDTHS.has(token));
}

describe("DS4 · two thresholds, three layouts", () => {
  it("reads the class strings, so nothing below is vacuous", () => {
    // A scanner that found no literals would pass both cases against an
    // app with no styling in it. `wide:` alone is used two dozen times.
    const wide = scan(/(?:^|\s)(?:wide|desk):(?=[a-z[-])/gu);
    expect(wide.length).toBeGreaterThan(20);
    expect(new Set(wide.map((entry) => entry.path)).size).toBeGreaterThan(5);
  });

  it("names no breakpoint but the two", () => {
    // "Never a third breakpoint." And the silent half: `--breakpoint-*` is
    // cleared, so `sm:` compiles to nothing — an element that simply never
    // responds, with no error anywhere. Tailwind's defaults are the ones a
    // lane reaches for from memory, which is why they are named here
    // rather than left to a general rule.
    expect(
      scan(OTHER_BREAKPOINT).map(
        (entry) => `${entry.path}: ${entry.token} in "${entry.literal}"`,
      ),
    ).toStrictEqual([]);
  });

  it("would notice one", () => {
    // Both cases above can only ever say "absent", so on their own they
    // cannot tell a working scan from one reading nothing. These are the
    // shapes each is looking for — and the two near-misses that must not
    // trip it: a lookup keyed `sm:` with a space after the colon, and the
    // mono step whose *name* ends in `-sm`.
    expect(variant("flex sm:hidden")).toHaveLength(1);
    expect(variant("flex max-[400px]:hidden")).toHaveLength(1);
    expect(variant("font-mono text-mono-sm uppercase")).toHaveLength(0);
    expect(variant("wide:hidden desk:grid")).toHaveLength(0);
  });
});

describe("DS4 · nothing pins a width that is not in MEASURE", () => {
  it("caps a column only at panel, column or page", () => {
    // 390, 620, 1180 — and the contract is explicit that every "centred
    // at phone width" surface is *exactly* `MEASURE.panel`. A `max-w-[NNNpx]`
    // or a Tailwind default like `max-w-sm` is a fourth measure nobody
    // agreed to, and the boards will not be redrawn to it.
    const offenders = scan(PINNED_WIDTH).filter(
      (entry) => !ALLOWED_WIDTHS.has(entry.token),
    );
    expect(
      offenders.map(
        (entry) => `${entry.path}: ${entry.token} in "${entry.literal}"`,
      ),
    ).toStrictEqual([]);
  });

  it("would notice one", () => {
    expect(pinned("mx-auto max-w-sm")).toStrictEqual(["max-w-sm"]);
    expect(pinned("w-[320px]")).toStrictEqual(["w-[320px]"]);
    expect(pinned("mx-auto max-w-column")).toStrictEqual([]);
    // Heights and positions are not widths, and the panel reads its offset
    // from the bar's own height rather than measuring the board.
    expect(pinned("wide:top-[var(--bar-height)] h-[var(--bar-height)]")).toStrictEqual(
      [],
    );
  });
});
