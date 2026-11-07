import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

/**
 * Rule 02 · contrast floors, measured against T1 itself.
 *
 * **Derived, not restated.** The roles, the light column and the dark
 * column are all parsed out of `design/Theme.dc.html`'s own table, so
 * importing a design round says which value moved instead of this file
 * quietly agreeing with a hex somebody typed twice. That is what caught
 * round 13's two: `--muted` was labelling controls at 3.90:1 and
 * `--dialed-text` was carrying nine meaning-bearing strings at 2.98:1,
 * both under a comment claiming they cleared.
 *
 * axe cannot do this job here — `color-contrast` needs a layout engine
 * that resolves a stylesheet and happy-dom applies none, so the rule can
 * only ever return "incomplete" (see `test/ui/axe.ts`). Measuring the
 * contract's values is also stricter than sampling whatever a component
 * happened to render: it fails for every screen at once, including the
 * ones nobody wrote a test for.
 *
 * Read off disk through the `read` helper the other CSS tests use, for the
 * reason `tokens.dom.test.tsx` gives at length.
 */
const read = (path: string): string =>
  readFileSync(new URL(path, import.meta.url), "utf8");

const theme = read("../../design/Theme.dc.html");
const tokens = read("../../src/ui/tokens.css");

/**
 * One T1 row: `['Muted', '--muted', '#7A7A70', '#8B8B93', 'note'],`.
 */
const T1_ROW =
  /\[\s*'[^']*',\s*'(?<role>--\w[\w-]*)',\s*'(?<light>#[\dA-Fa-f]{6})',\s*'(?<dark>#[\dA-Fa-f]{6})'/gu;

interface Pair {
  readonly role: string;
  readonly light: string;
  readonly dark: string;
}

/**
 * `Array.from(iterable, mapFn)`, and that is not a style preference.
 *
 * `[...theme.matchAll(T1_ROW)].map(…)` trips
 * `unicorn/prefer-iterator-to-array`, whose advice is `Iterator#toArray()`
 * — which this project's TS lib does not have, so taking it turns one
 * lint error into a dozen `any` errors downstream. CLAUDE.md records that
 * trap, and three fix passes walked into it on this file. `Array.from`
 * with a mapping function consumes the iterator directly: no spread, no
 * intermediate array, and nothing for either rule to object to.
 */
const t1: Pair[] = Array.from(theme.matchAll(T1_ROW), (match) => ({
  role: match.groups?.role ?? "",
  light: (match.groups?.light ?? "").toLowerCase(),
  dark: (match.groups?.dark ?? "").toLowerCase(),
}));

/**
 * The `--name: value;` declarations inside one selector's block.
 */
function declarations(selector: string): Map<string, string> {
  const open = tokens.indexOf(selector);
  const start = tokens.indexOf("{", open);
  let depth = 0;
  let end = start;
  for (; end < tokens.length; end += 1) {
    if (tokens.charAt(end) === "{") depth += 1;
    else if (tokens.charAt(end) === "}") {
      depth -= 1;
      if (depth === 0) break;
    }
  }
  const found = new Map<string, string>();
  for (const match of tokens
    .slice(start, end)
    .matchAll(/(?<name>--\w[\w-]*):(?<value>[^;]+);/gu)) {
    const { name, value } = match.groups ?? {};
    if (name !== undefined && value !== undefined)
      found.set(name, value.trim());
  }
  return found;
}

/**
 * The two columns as the app resolves them: the roles that do not change
 * are declared on `:root`, and each column's ground-relative roles in its
 * own utility. A role a column leaves out falls through to `:root`, which
 * is what "does not change with the ground" means in code.
 */
const root = declarations(":root");
const paper = new Map([...root, ...declarations("@utility ground-paper")]);
const ink = new Map([...root, ...declarations("@utility ground-ink")]);

/**
 * A role's actual colour, following `var(--x)` as far as it goes.
 *
 * Required rather than tidy: half the table points at the palette
 * (`--action: var(--course-pink)`) or at another role (`--label:
 * var(--muted)` in the ink block, which is how T1's "dark folds into
 * --muted" is written as code rather than as a comment). A reader that
 * stopped at the first value would compare a variable name to a hex.
 */
function hexOf(role: string, block: Map<string, string>): string {
  let value = block.get(role) ?? "";
  // Ten hops is far more than the two the table ever needs; the bound is
  // what stops a circular definition hanging the suite instead of failing.
  for (let hop = 0; hop < 10; hop += 1) {
    const indirect = /^var\((?<name>--\w[\w-]*)\)$/u.exec(value);
    if (indirect === null) break;
    const name = indirect.groups?.name ?? "";
    value = block.get(name) ?? "";
  }
  return value.toLowerCase();
}

/**
 * WCAG 2.x relative luminance, and the ratio between two of them.
 *
 * Written out rather than pulled from a package: it is eight lines, it is
 * the definition the contract's own numbers come from, and a dependency
 * whose job is one formula is a dependency whose version can change the
 * answer.
 */
function luminance(hex: string): number {
  const channels = [1, 3, 5].map(
    (at) => Number.parseInt(hex.slice(at, at + 2), 16) / 255,
  );
  const linear = channels.map((channel) =>
    channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4,
  );
  return (
    0.2126 * (linear[0] ?? 0) +
    0.7152 * (linear[1] ?? 0) +
    0.0722 * (linear[2] ?? 0)
  );
}

function contrast(a: string, b: string): number {
  const [high = 0, low = 0] = [luminance(a), luminance(b)].toSorted(
    (x, y) => y - x,
  );
  return (high + 0.05) / (low + 0.05);
}

describe("the T1 port", () => {
  it("parsed the table, so nothing below is vacuous", () => {
    // Twenty rows: round 13 added `--label`, round 19 the two hover
    // states, round 21 `--hiviz-text` and `--dialed-tint`. A parser that
    // matched nothing would make every case below pass against no colours
    // at all.
    expect(t1).toHaveLength(20);
    expect(t1.map((pair) => pair.role)).toContain("--label");
    expect(paper.size).toBeGreaterThan(15);
  });

  it("writes each column once and has every selector take it", () => {
    // `ground-paper` and `ground-ink` are the only copies. The page, the
    // inverted block (both ways round), the breakpoint header and the
    // night block all apply one of them; a second copy anywhere would be a
    // rival truth that nothing makes disagree out loud.
    expect(paper.size - root.size).toBeGreaterThan(10);
    expect(ink.size - root.size).toBeGreaterThan(10);
    expect(tokens).toMatch(/:root \{[^}]*@apply ground-paper;/u);
    const applies = tokens.match(/@apply [\w:-]+;/gu)?.length;
    // :root, the dark page twice, the inverted block and its breakpoint
    // header on each page (six), and night.
    expect(applies).toBe(10);
  });

  it.each(t1)("declares $role at T1's light value", ({ role, light }) => {
    expect([role, hexOf(role, paper)]).toEqual([role, light]);
  });

  it.each(t1)("declares $role at T1's dark value", ({ role, dark }) => {
    // The whole column, R-87's `--unread` included: the dark theme takes
    // this set for the page, so a role missing from it is a role that
    // stays light on a dark screen.
    expect([role, hexOf(role, ink)]).toEqual([role, dark]);
  });
});

/**
 * The grounds text sits on. `--tint` and `--unread` are washes a block
 * wears, so prose lands on them too.
 */
const GROUNDS = ["--ground", "--panel", "--tint", "--unread"] as const;

/**
 * Roles rule 02 calls body text, against every ground they reach.
 *
 * `--muted` and `--placeholder` are **not** here, and that is the rule
 * rather than an omission: T1 says both are "decoration-only — never the
 * sole label of a control", so the floor they answer to is a markup
 * question (nothing may be labelled in them) rather than a ratio.
 */
const BODY_TEXT = ["--ink", "--quiet", "--cold-text", "--dialed-text"] as const;

describe("02 · contrast floors, light column", () => {
  it.each(
    BODY_TEXT.flatMap((text) =>
      GROUNDS.map((ground) => [text, ground] as const),
    ),
  )("%s on %s clears 4.5:1", (text, ground) => {
    expect(
      contrast(hexOf(text, paper), hexOf(ground, paper)),
    ).toBeGreaterThanOrEqual(4.5);
  });

  it.each(["--ground", "--panel", "--unread"] as const)(
    "--label clears 4.5:1 on %s",
    (ground) => {
      expect(
        contrast(hexOf("--label", paper), hexOf(ground, paper)),
      ).toBeGreaterThanOrEqual(4.5);
    },
  );

  it("records the one pairing --label does not clear, rather than omitting it", () => {
    // 4.34:1 on `--tint`. It is left out of the case above rather than
    // quietly passing, because the pairing does not occur: `--tint` is a
    // recessed block for explanations and quiet notes, and a field caption
    // labels a box that is `bg-ground`. If a form ever lands inside a tint
    // block this becomes a real failure, and the number is here so the
    // next reader does not have to re-derive it.
    const measured = contrast(hexOf("--label", paper), hexOf("--tint", paper));
    expect(measured).toBeGreaterThan(4.3);
    expect(measured).toBeLessThan(4.5);
  });

  it.each(["--action", "--failure"] as const)(
    "ink on %s clears 4.5:1, because text on an accent is always ink",
    (accent) => {
      // "Text on any accent surface is ink #0B0B0E" — the fixed colour,
      // not the role. T1's own note on both rows is "does not change",
      // which is why they resolve to the palette rather than to a ground.
      expect(
        contrast(hexOf("--ink", paper), hexOf(accent, paper)),
      ).toBeGreaterThanOrEqual(4.5);
    },
  );

  it("clears 4.5:1 for ink on teal, the accent T1 names in prose", () => {
    // Teal as a *surface* has no T1 row — "teal as a surface is #00E0C6 on
    // both" (T2 rule 01) — and `EntryDetail` puts ink on it for the
    // "useful" pill, so it is measured here with the other two.
    expect(
      contrast(hexOf("--ink", paper), hexOf("--split-teal", paper)),
    ).toBeGreaterThanOrEqual(4.5);
  });

  it("would fail if a role drifted under its floor", () => {
    // Every case above says "clears", which a broken `contrast` returning
    // Infinity would also say. #009F8C is the exact hex round 13 retired,
    // and it is the reason this file exists.
    expect(contrast("#009f8c", hexOf("--ground", paper))).toBeLessThan(4.5);
  });
});

/**
 * R48·134's build check: "The build checks each pair against tokens.js and
 * reports any that fail as a delta." The same floors, on the dark column.
 *
 * Two pairings miss, both on `--unread` (`#2A2A14`), and they are recorded
 * rather than skipped so the number is here when Design answers the ask
 * (design 185). Every other pair below clears.
 */
const DARK_MISSES = new Set(["--cold-text on --unread"]);

describe("02 · contrast floors, dark column", () => {
  it.each(
    BODY_TEXT.flatMap((text) =>
      GROUNDS.map((ground) => [text, ground] as const),
    ).filter(([text, ground]) => !DARK_MISSES.has(`${text} on ${ground}`)),
  )("%s on %s clears 4.5:1", (text, ground) => {
    expect(
      contrast(hexOf(text, ink), hexOf(ground, ink)),
    ).toBeGreaterThanOrEqual(4.5);
  });

  it.each(["--ground", "--panel", "--tint"] as const)(
    "--label clears 4.5:1 on %s",
    (ground) => {
      // On ink `--label` clears `--tint` too (5.0:1), the pairing paper
      // records as its one miss.
      expect(
        contrast(hexOf("--label", ink), hexOf(ground, ink)),
      ).toBeGreaterThanOrEqual(4.5);
    },
  );

  it("records the two pairings on the dark unread tint that do not clear", () => {
    // 4.16:1 for pink-as-text and 4.31:1 for `--label` on `#2A2A14`. The
    // bell's unread row carries neither today (its text is `--ink` and
    // `--quiet`, 13.1:1 and 7.3:1), so neither is drawn yet; they are the
    // delta R48·134 asks for, not a pass.
    const cold = contrast(hexOf("--cold-text", ink), hexOf("--unread", ink));
    const label = contrast(hexOf("--label", ink), hexOf("--unread", ink));
    expect(cold).toBeGreaterThan(4.1);
    expect(cold).toBeLessThan(4.5);
    expect(label).toBeGreaterThan(4.3);
    expect(label).toBeLessThan(4.5);
    expect(DARK_MISSES.size).toBe(1);
  });

  it.each(["--action", "--failure", "--split-teal"] as const)(
    "accent ink on %s clears 4.5:1 on the dark column too",
    (accent) => {
      // T2 rule 02: "Pink, teal and hi-viz surfaces carry #0B0B0E text in
      // both modes." On ink `--ink` is chalk, so the role that says it is
      // `--accent-ink`, which no column redefines.
      expect(hexOf("--accent-ink", ink)).toBe("#0b0b0e");
      expect(
        contrast(hexOf("--accent-ink", ink), hexOf(accent, ink)),
      ).toBeGreaterThanOrEqual(4.5);
    },
  );
});
