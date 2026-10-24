import { describe, expect, it } from "vitest";

import { isInstrumented, repoPath, withoutComments } from "./source-text";

/**
 * **Nothing renders the `disabled` attribute.**
 *
 * `docs/product.md` §Forms & failure: a disabled control drops focus and
 * stops announcing, so a submit in flight is `aria-disabled` + `aria-busy`
 * (`inFlight()` in `ui/form.tsx`) and the double-submit guard lives in the
 * handler. A control that cannot act is `aria-disabled`, never `disabled`.
 *
 * What it reads: `disabled` as a JSX attribute (`disabled`, `disabled={…}`)
 * or as an object key spread into props (`disabled: true`). What it leaves
 * alone: `aria-disabled`, and Tailwind's `disabled:` variant, which has no
 * space after the colon.
 */

const sources: Record<string, string> = import.meta.glob(
  ["../../src/**/*.tsx", "!../../src/**/*.test.tsx"],
  { query: "?raw", import: "default", eager: true },
);

const DISABLED = /(?<![\w-])disabled(?=[\s=/>]|:\s)/gu;

function disabledIn(path: string, source: string): string[] {
  return Array.from(
    withoutComments(source).matchAll(DISABLED),
    (match) => `${path}@${String(match.index)}`,
  );
}

const files = Object.entries(sources)
  .map(([globPath, source]) => [repoPath(globPath), source] as const)
  .filter(([, source]) => !isInstrumented(source));

describe("no disabled attribute", () => {
  it("found the components, so nothing below is vacuous", () => {
    expect(files.length).toBeGreaterThan(40);
    expect(files.some(([path]) => path === "src/ui/form.tsx")).toBe(true);
  });

  it("is written nowhere in a component", () => {
    expect(
      files.flatMap(([path, source]) => disabledIn(path, source)),
      "use aria-disabled (+ aria-busy in flight) and guard in the handler (see .claude/rules/ui.md §Forms)",
    ).toEqual([]);
  });

  it("would catch the attribute and the spread key, and not aria or the variant", () => {
    expect(disabledIn("a.tsx", "<button disabled>x</button>")).toHaveLength(1);
    expect(disabledIn("a.tsx", "<button disabled={busy} />")).toHaveLength(1);
    expect(disabledIn("a.tsx", "<input disabled/>")).toHaveLength(1);
    expect(disabledIn("a.tsx", "const p = { disabled: true };")).toHaveLength(
      1,
    );
    expect(disabledIn("a.tsx", "<button aria-disabled={busy} />")).toEqual([]);
    expect(disabledIn("a.tsx", 'className="disabled:opacity-40"')).toEqual([]);
    expect(disabledIn("a.tsx", "// never disabled \n")).toEqual([]);
  });
});
