import { describe, expect, it } from "vitest";

import { isInstrumented, repoPath, withoutComments } from "./source-text";

/**
 * Rule 02's last sentence · **opacity never encodes meaning**.
 *
 * Also §AB rule 04, also T1's own note on `--quiet` ("full strength, never
 * opacity"), also `ink.css`'s comment on why `text-night/30` was retired —
 * which is four statements of one rule and, until now, nothing that made
 * any of them true.
 *
 * It was not true. Nine controls dimmed themselves to 40–50% to say
 * "unavailable": `disabled:opacity-40` on the Useful button, the follow
 * button and the attach button, `disabled:opacity-50` on Save temperature
 * and the three Strava buttons. Design's round 13 retired all nine along
 * with the `disabled` attribute they hung off — *"the 40–50% dim is gone
 * from all nine; nothing replaces it"* — and this is what stops the tenth.
 *
 * **The rule is about a fade that carries a fact**, so it is written as
 * one: an opacity that is *neither* 0 nor 100 is a value halfway between
 * present and absent, and the only reason to draw that is to mean
 * something by it. `opacity-0` is not a fade — it is a control that is
 * there and invisible, which the two chip inputs need and which the label
 * around them draws instead.
 */

const sources: Record<string, string> = import.meta.glob(
  ["../../src/ui/**/*.tsx", "../../src/modules/**/*.tsx", "../../src/routes/**/*.tsx"],
  { query: "?raw", import: "default", eager: true },
);

/**
 * `opacity-40`, `hover:opacity-70`, `disabled:opacity-50` — any Tailwind
 * opacity utility that lands between invisible and solid, variant or not.
 */
const PARTIAL_OPACITY = /\bopacity-(?!0\b)(?!100\b)\d+/gu;

/**
 * An opacity utility behind a state variant, at any value.
 *
 * Separate from the rule above because the failure is different in kind: a
 * variant is opacity **reacting to a state**, which is encoding by
 * definition, and it would still be encoding at `opacity-0`.
 */
const STATEFUL_OPACITY = /\b[\w-]+:opacity-\d+/gu;

const files = Object.entries(sources)
  .map(([globPath, source]) => [repoPath(globPath), source] as const)
  // Stryker rewrites source in its sandbox and Vite's `?raw` inlines the
  // rewrite, so a mutation run would scan its own instrumentation.
  .filter(([, source]) => !isInstrumented(source));

describe("02 · opacity never encodes meaning", () => {
  it("found the components, so nothing below is vacuous", () => {
    expect(files.length).toBeGreaterThan(40);
  });

  it.each(files.map(([path]) => path))("%s fades nothing part-way", (path) => {
    const source = withoutComments(sources[`../../${path}`] ?? "");
    expect(source.match(PARTIAL_OPACITY)).toBeNull();
  });

  it.each(files.map(([path]) => path))(
    "%s changes no opacity on a state",
    (path) => {
      const source = withoutComments(sources[`../../${path}`] ?? "");
      expect(source.match(STATEFUL_OPACITY)).toBeNull();
    },
  );

  it("still allows a control to be invisible where its label is the mark", () => {
    // `opacity-0` on the chip inputs, which fill their label's box so a
    // pointer aimed at the chip lands on the control — `sr-only` clips to
    // a 1px corner and breaks exactly that. Nothing is being said by the
    // fade, because there is no fade: the element is a hit area and the
    // label is the drawing.
    expect("appearance-none opacity-0".match(PARTIAL_OPACITY)).toBeNull();
    expect("appearance-none opacity-0".match(STATEFUL_OPACITY)).toBeNull();
  });

  it("would catch both shapes", () => {
    // Every case above says "no match", which a broken pattern would also
    // say. These are the two that were really in the codebase.
    expect("px-4 disabled:opacity-40".match(PARTIAL_OPACITY)).toEqual([
      "opacity-40",
    ]);
    expect("px-4 disabled:opacity-40".match(STATEFUL_OPACITY)).toEqual([
      "disabled:opacity-40",
    ]);
    // And the variant rule catches a stateful fade even at a legal value.
    expect("hover:opacity-100".match(PARTIAL_OPACITY)).toBeNull();
    expect("hover:opacity-100".match(STATEFUL_OPACITY)).toEqual([
      "hover:opacity-100",
    ]);
  });
});
