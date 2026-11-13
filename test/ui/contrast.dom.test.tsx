import { readdirSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

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
/**
 * One `@utility` block's text, up to the next one.
 */
function block(name: string): string {
  return (
    tokens
      .slice(tokens.indexOf(`@utility ${name} {`))
      .split(/\n@utility /u, 1)[0] ?? ""
  );
}

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
    // :root, the dark page twice, the ink block and its breakpoint header,
    // the dark page's panel block, its bottom-ruled bar, panel header and
    // row press (each twice: the attribute and the media query), and night.
    expect(applies).toBe(14);
  });

  it("puts a dark page's ink blocks on rule 04's fallback, --panel with a hairline (R50·143.1)", () => {
    // The fallback moves only the ground, so the block keeps the dark
    // column's roles and needs no copy of them.
    const panel = declarations("@utility ground-panel");
    expect([...panel]).toEqual([["--ground", "var(--panel)"]]);
    expect(tokens).toMatch(
      /@utility ground-panel \{[^}]*@apply inset-ring-1 inset-ring-hairline;/u,
    );
    // Both ways the page is dark, and both kinds of block. Never paper:
    // "a paper block on a dark page would be the brightest thing on the
    // screen". Only a row press still inverts.
    for (const page of [
      String.raw`:root\[data-theme="dark"\]`,
      String.raw`:root:not\(\[data-theme="light"\]\)`,
    ]) {
      expect(tokens).toMatch(
        new RegExp(
          String.raw`${page} \[data-ground="ink"\] \{\s*@apply ground-panel;`,
          "u",
        ),
      );
      expect(tokens).toMatch(
        new RegExp(
          String.raw`${page} \[data-ground="ink-until-wide"\] \{\s*@apply max-wide:ground-panel;`,
          "u",
        ),
      );
      expect(tokens).toMatch(
        new RegExp(
          String.raw`${page} \.row-press:active \{\s*@apply ground-paper;`,
          "u",
        ),
      );
    }
    expect(tokens).not.toMatch(
      /\[data-ground="ink[^\]]*\][^{]*\{\s*@apply[^;]*ground-paper/u,
    );
    // The Desk reads nothing from the page.
    expect(tokens).toMatch(/\[data-ground="night"\] \{\s*@apply ground-ink;/u);
  });

  it("rules a full-bleed dark block underneath only, on the same panel (#632 R-01)", () => {
    const ruled = declarations("@utility ground-panel-ruled");
    expect([...ruled]).toEqual([["--ground", "var(--panel)"]]);
    expect(tokens).toMatch(
      /@utility ground-panel-ruled \{[^}]*box-shadow: inset 0 -1px 0 var\(--hairline\);/u,
    );
    for (const page of [
      String.raw`:root\[data-theme="dark"\]`,
      String.raw`:root:not\(\[data-theme="light"\]\)`,
    ]) {
      expect(tokens).toMatch(
        new RegExp(
          String.raw`${page} \[data-ground="ink"\]\[data-edge="bottom"\] \{\s*@apply ground-panel-ruled;`,
          "u",
        ),
      );
    }
  });

  it("gives a dark phone sheet the panel, a hairline on three sides and a grabber (Design 165)", () => {
    expect([...declarations("@utility ground-sheet")]).toEqual([
      ["--ground", "var(--panel)"],
    ]);
    const sheet = tokens.slice(tokens.indexOf("@utility ground-sheet") + 1);
    expect(sheet).toMatch(/^[^@]*border: 1px solid var\(--hairline\);/u);
    expect(sheet).toMatch(/^[^@]*border-bottom-width: 0;/u);
    expect(sheet).toMatch(
      /^[^@]*&::before \{[^}]*width: 36px;[^}]*height: 4px;[^}]*background: var\(--hairline-2\);/u,
    );
  });

  it("gives the desk drawer the panel, a hairline all round and the lift (R54·164.1)", () => {
    expect([...declarations("@utility ground-drawer")]).toEqual([
      ["--ground", "var(--panel)"],
    ]);
    expect(tokens).toMatch(
      /@utility ground-drawer \{[^}]*border: 1px solid var\(--hairline\);[^}]*box-shadow: var\(--lift\);/u,
    );
    // The lift is built from the scrim, never a typed colour.
    expect(tokens).toMatch(
      /--lift: 0 8px 28px color-mix\(in srgb, var\(--scrim\) 10%, transparent\);/u,
    );
    expect(tokens).toContain("--sheet-cap: 90dvh;");
  });

  it("draws the checkbox, radio and switch as ruled, with the contract's focus ring (R54·166)", () => {
    // Focus: rule 06's outline, whose 2px offset is the --ground gap, in
    // pink — unlayered, so it beats rule 06's ink, and only for these three.
    expect(tokens).toMatch(
      /:is\(\.control-check, \.control-radio, \.control-switch\):focus-visible \{\s*outline-color: var\(--action\);\s*\}/u,
    );
    for (const name of ["control-check", "control-radio", "control-switch"]) {
      expect([name, block(name).includes("appearance: none;")]).toEqual([
        name,
        true,
      ]);
      expect([
        name,
        block(name).includes("border: 2px solid var(--ink);"),
      ]).toEqual([name, true]);
    }
    // 166.1: a 20 square at RADIUS.tight; on, an ink fill and a --ground tick.
    const check = block("control-check");
    expect(check).toMatch(/width: 20px;\s*height: 20px;/u);
    expect(check).toContain("border-radius: var(--radius-tight);");
    expect(check).toMatch(/&:checked \{\s*background: var\(--ink\);/u);
    expect(check).toMatch(/border: solid var\(--ground\);/u);
    // 166.2: a 20 ring with a 10 ink dot.
    const radio = block("control-radio");
    expect(radio).toMatch(/width: 20px;\s*height: 20px;/u);
    expect(radio).toMatch(
      /width: 10px;\s*height: 10px;[^}]*background: var\(--ink\);/u,
    );
    // 166.3: a 48×28 track; on, pink with the knob at the right.
    const toggle = block("control-switch");
    expect(toggle).toMatch(/width: 48px;\s*height: 28px;/u);
    expect(toggle).toMatch(
      /&:checked \{\s*justify-content: flex-end;\s*background: var\(--action\);/u,
    );
  });

  it("gives night the browser's dark controls, whatever the runner's theme (#627 P3-02)", () => {
    expect(tokens).toMatch(
      /\[data-ground="night"\] \{[^}]*color-scheme: dark;/u,
    );
  });

  it("gives a dark page's ink block eyebrows hi-viz on --panel (#494 item 7)", () => {
    // With no block turning paper, `--hiviz-text` is hi-viz wherever it is
    // used: on ink on a light page, on `--panel` on a dark one.
    expect(hexOf("--hiviz-text", ink)).toBe("#f5ff3d");
    expect(
      contrast(hexOf("--hiviz-text", ink), hexOf("--panel", ink)),
    ).toBeGreaterThan(16);
  });

  it("gives the forms' ink surface R-36's values through the roles they draw in", () => {
    // Form Contract: idle "1px rule" is `--hairline`, invalid "2px ink (2px
    // paper on dark)" is `--ink` — `ui/form.tsx`'s field box draws in
    // exactly those two, so the dark column is the ink surface.
    expect(hexOf("--hairline", ink)).toBe("#2a2a31");
    expect(hexOf("--ink", ink)).toBe("#f4f3ef");
    expect(hexOf("--failure", ink)).toBe(hexOf("--failure", paper));
  });

  it("keeps the scrim #0B0B0E in both themes (R48·134)", () => {
    expect(hexOf("--scrim", paper)).toBe("#0b0b0e");
    expect(hexOf("--scrim", ink)).toBe("#0b0b0e");
  });

  it("draws a notice as the tint on paper and as a ruled panel on ink", () => {
    // R48·135: "Light-ground notices in the app become --panel with a 1px
    // --hairline (the marketing ink-block rule)." On paper the rule is the
    // fill's own colour, so nothing changes there. Not a T1 row: two roles
    // that point at T1 rows, so their text clears wherever those do.
    expect(hexOf("--notice", paper)).toBe(hexOf("--tint", paper));
    expect(hexOf("--notice-rule", paper)).toBe(hexOf("--tint", paper));
    expect(hexOf("--notice", ink)).toBe(hexOf("--panel", ink));
    expect(hexOf("--notice-rule", ink)).toBe(hexOf("--hairline", ink));
  });

  it.each(t1.filter((pair) => pair.role !== "--hiviz-text"))(
    "declares $role at T1's light value",
    ({ role, light }) => {
      expect([role, hexOf(role, paper)]).toEqual([role, light]);
    },
  );

  it("writes --hiviz-text as T1's note says rather than its light cell", () => {
    // T1's light cell is #F5FF3D, written for a block that was ink in
    // both themes; its note says "never text on paper; there it is
    // --ink". Headers invert to paper on a dark page (T2 rule 04), so the
    // paper column takes the note (design 185, design-ask #494): ink on
    // paper, hi-viz on ink. The cell is still what the ink column holds.
    const cell = t1.find((pair) => pair.role === "--hiviz-text");
    expect(cell?.light).toBe("#f5ff3d");
    expect(hexOf("--hiviz-text", paper)).toBe(hexOf("--ink", paper));
    expect(hexOf("--hiviz-text", ink)).toBe(cell?.light);
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

/**
 * R50·142: "A rule, not a new value: --cold-text and --label never sit on
 * --unread, in either theme. The unread row uses only --ink and --quiet."
 * So these are not floors to measure: they are pairs nothing may draw.
 */
const FORBIDDEN_ON_UNREAD = ["--cold-text", "--label"] as const;

const isForbidden = (text: string, ground: string): boolean =>
  ground === "--unread" &&
  FORBIDDEN_ON_UNREAD.some((forbidden) => forbidden === text);

const floorPairs = BODY_TEXT.flatMap((text) =>
  GROUNDS.map((ground) => [text, ground] as const),
).filter(([text, ground]) => !isForbidden(text, ground));

describe("02 · contrast floors, light column", () => {
  it.each(floorPairs)("%s on %s clears 4.5:1", (text, ground) => {
    expect(
      contrast(hexOf(text, paper), hexOf(ground, paper)),
    ).toBeGreaterThanOrEqual(4.5);
  });

  it.each(["--ground", "--panel"] as const)(
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
 * Every pair clears except the two R50·142 forbids, which are not drawn.
 */
describe("02 · contrast floors, dark column", () => {
  it.each(floorPairs)("%s on %s clears 4.5:1", (text, ground) => {
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

/**
 * Every source file under `src/`, as text. Read through `node:fs` for the
 * reason the file header gives. The directory is a path string, not a
 * `URL`: happy-dom replaces the global `URL`, and `readdirSync` rejects
 * its instances (`read` gets away with it because `readFileSync` does not
 * check the scheme the same way).
 */
function sourceFiles(): Map<string, string> {
  const root = fileURLToPath(import.meta.url).replace(
    /test\/ui\/[^/]+$/u,
    "src/",
  );
  const paths = readdirSync(root, { recursive: true })
    .map(String)
    .filter((path) => /\.tsx?$/u.test(path));
  return new Map(paths.map((path) => [path, read(`../../src/${path}`)]));
}

describe("142 · what never sits on the unread tint", () => {
  it.each(FORBIDDEN_ON_UNREAD)(
    "states %s on --unread as forbidden in both columns, rather than measuring it",
    (text) => {
      // Kept out of every floor above in both columns, so the rule is the
      // only thing said about the pair. A pass here does not depend on the
      // ratio, which is why `#2A2A14` stays (R50·142).
      for (const column of [paper, ink]) {
        expect(hexOf(text, column)).toMatch(/^#[\da-f]{6}$/u);
        expect(hexOf("--unread", column)).toMatch(/^#[\da-f]{6}$/u);
      }
      expect(floorPairs).not.toContainEqual([text, "--unread"]);
      expect(floorPairs).toContainEqual(["--ink", "--unread"]);
      expect(floorPairs).toContainEqual(["--quiet", "--unread"]);
    },
  );

  it("finds no file that draws the unread tint and either forbidden role", () => {
    // Coarse on purpose: a file that paints `bg-unread` keeps
    // `text-cold-text` and `text-label` out entirely. The unread row is
    // `--ink` and `--quiet` only. Nothing paints `bg-unread` today (the
    // bell's unread row is a white row with a pink dot), so this guards
    // the next one.
    const files = sourceFiles();
    expect(files.size).toBeGreaterThan(100);
    const offenders = [...files]
      .filter(([, text]) => text.includes("bg-unread"))
      .filter(([, text]) =>
        FORBIDDEN_ON_UNREAD.some((role) =>
          text.includes(`text-${role.slice(2)}`),
        ),
      )
      .map(([path]) => path);
    expect(offenders).toEqual([]);
  });

  it("would catch a file that broke the rule", () => {
    // The scan above returns nothing today, which a scan that read nothing
    // would also return. The same predicate on a made-up row.
    const row = '<li className="bg-unread text-label">';
    expect(row.includes("bg-unread")).toBe(true);
    expect(
      FORBIDDEN_ON_UNREAD.some((role) => row.includes(`text-${role.slice(2)}`)),
    ).toBe(true);
  });
});
