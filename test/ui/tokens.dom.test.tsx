import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

/**
 * Read off disk rather than imported, and named `.dom.` to say so.
 *
 * `icons.test.tsx` gets `design/icons.js?raw` inlined by Vite, and the same
 * trick returns an **empty string** for `src/styles.css?raw`: Vite's CSS
 * plugin claims the file before `?raw` is honoured, so every assertion below
 * would have passed against a theme block that was never read. The workers
 * pool sandboxes the real filesystem, so this opts into the jsdom project —
 * which runs in Node and has one — by its filename, the way
 * `vitest.config.ts` says a test picks a project.
 */
const read = (path: string): string =>
  readFileSync(new URL(path, import.meta.url), "utf8");

const tokenSource = read("../../design/tokens.js");
const styles = read("../../src/styles.css");

/**
 * `design/tokens.js` is untyped JS in a read-only archive, so the port in
 * `src/styles.css` cannot be derived from it — it is the mirror-rather-than-
 * derive shape CLAUDE.md warns about, two copies of one truth with nothing
 * to make them disagree loudly. This pins them.
 *
 * Import a new design round and this says which step moved, instead of the
 * app quietly rendering last round's scale.
 */

/**
 * One parsed step: `display: { family: 'display', size: 32, lineHeight: 1.05,
 * tracking: -0.035, … }`.
 */
interface Step {
  size: number;
  lineHeight: number;
  tracking: number;
}

function section(name: string): string {
  const open = tokenSource.indexOf(`export const ${name} = {`);
  if (open === -1) return "";
  // `SPACE` closes on its own line; the rest close on a later one. The
  // trailing comments have to go before anything counts pairs, because
  // RADIUS documents its own collapses as "(boards: 9 → 8)" and a
  // `\w+: \d+` reader takes that for a sixth radius.
  const close = tokenSource.indexOf("};", open);
  const body = close === -1 ? "" : tokenSource.slice(open, close);
  return body.replaceAll(/\/\/[^\n]*/g, "");
}

// Fixed-width separators rather than `\s+`: tokens.js aligns its columns with
// runs of spaces, and a `\s`-based reader of aligned columns backtracks.
const STEP_ENTRY =
  /^ {2}(\w+): +\{ family: '\w+', +size: (\d+), +lineHeight: (\d+(?:\.\d+)?), +tracking: (-?\d+(?:\.\d+)?),/gm;

function steps(name: string): [string, Step][] {
  const found: [string, Step][] = [];
  for (const match of section(name).matchAll(STEP_ENTRY)) {
    const [, step, size, lineHeight, tracking] = match;
    if (step === undefined) continue;
    found.push([
      step,
      {
        size: Number(size),
        lineHeight: Number(lineHeight),
        tracking: Number(tracking),
      },
    ]);
  }
  return found;
}

function scalars(name: string): [string, number][] {
  const found: [string, number][] = [];
  // Anchored on the separator a key can follow — `{` for SPACE's one-liner,
  // a comma or the line start for the rest. An unanchored `(\w+): (\d+)`
  // backtracks across every word in the block's prose.
  for (const match of section(name).matchAll(/(?:^|[{,]) *(\w+): (\d+)/gm)) {
    const [, key, value] = match;
    if (key === undefined || key === name) continue;
    found.push([key, Number(value)]);
  }
  return found;
}

/**
 * Every `--name: value;` declared inside the `@theme inline` block.
 */
const theme: Record<string, string> = {};
{
  const open = styles.indexOf("@theme inline {");
  const close = styles.indexOf("\n}", open);
  for (const match of styles
    .slice(open, close)
    .matchAll(/^ {2}(--[\w*-]+): ([^;]+);$/gm)) {
    const [, name, value] = match;
    if (name !== undefined && value !== undefined) theme[name] = value.trim();
  }
}

const themeKeys = (prefix: string): string[] =>
  Object.keys(theme).filter((name) => name.startsWith(prefix));

const px = (value: string | undefined): number =>
  Number(value?.replace("px", ""));

const em = (value: string | undefined): number =>
  Number(value?.replace("em", ""));

describe("the ported value contract (design/tokens.js)", () => {
  it("parsed every section, so nothing below is vacuous", () => {
    // A parser that silently matched nothing would make every assertion in
    // this file pass against an empty app.
    expect(steps("TYPE")).toHaveLength(7);
    expect(steps("MONO")).toHaveLength(4);
    expect(scalars("SPACE")).toHaveLength(9);
    expect(scalars("RADIUS")).toHaveLength(6);
    expect(scalars("BREAKPOINT")).toHaveLength(2);
    expect(scalars("MEASURE")).toHaveLength(3);
    expect(Object.keys(theme).length).toBeGreaterThan(50);
  });

  it("carries all seven TYPE steps, each with its own line-height and tracking", () => {
    // Law 1: tracking is a function of size, not context. Tailwind pairs
    // `--text-x--letter-spacing` with the size, so porting the triple is what
    // makes that true in the app rather than true on paper.
    for (const [name, step] of steps("TYPE")) {
      expect({ name, ...step }).toEqual({
        name,
        size: px(theme[`--text-${name}`]),
        lineHeight: Number(theme[`--text-${name}--line-height`]),
        tracking: em(theme[`--text-${name}--letter-spacing`]),
      });
    }
  });

  it("carries all four MONO steps, and the four trackings that broke Mono", () => {
    // The ramp has four trackings — 0.10 / 0.06 / 0.02 / 0.02 — and `Mono`
    // used to hardcode 0.08em, a value no step has. That is what produced 17
    // call sites spelling their own.
    const ramp = steps("MONO");
    expect(ramp.map(([, step]) => step.tracking)).toEqual([
      0.1, 0.06, 0.02, 0.02,
    ]);
    for (const [name, step] of ramp) {
      expect({ name, ...step }).toEqual({
        name,
        size: px(theme[`--text-mono-${name}`]),
        lineHeight: Number(theme[`--text-mono-${name}--line-height`]),
        tracking: em(theme[`--text-mono-${name}--letter-spacing`]),
      });
    }
  });

  it("declares no font size the contract does not name", () => {
    // The point of the lane: Tailwind's own `text-sm` (14px) is a step
    // tokens.js has no entry for, and 86 elements had reached for it. The
    // namespace is cleared, and this is what stops it growing back.
    const named = new Set([
      ...steps("TYPE").map(([step]) => `--text-${step}`),
      ...steps("MONO").map(([step]) => `--text-mono-${step}`),
    ]);
    // `--text-body--line-height` is the step's own pairing, not a step.
    const declared = themeKeys("--text-").filter(
      (name) => !name.includes("--", 2),
    );
    expect(declared.filter((name) => !named.has(name))).toEqual(["--text-*"]);
    expect(named.size).toBe(11);
  });

  it("collapses tracking and line-height into the step, with nothing to override them", () => {
    // `tracking-wide` and `leading-snug` were both in use. A step whose
    // tracking can be overridden is a step whose tracking is advisory.
    expect(theme["--tracking-*"]).toBe("initial");
    expect(theme["--leading-*"]).toBe("initial");
    expect(themeKeys("--tracking-")).toHaveLength(1);
    expect(themeKeys("--leading-")).toHaveLength(1);
  });

  it("puts every RADIUS on the theme, and keeps `none` literal", () => {
    // RADIUS.none is not an absence of styling — square is the brand's tell
    // for "this is a statement, not a control" — so it stays `rounded-none`,
    // a static utility, rather than a 0px variable.
    for (const [name, value] of scalars("RADIUS")) {
      if (name === "none") {
        expect(value).toBe(0);
        continue;
      }
      expect([name, px(theme[`--radius-${name}`])]).toEqual([name, value]);
    }
  });

  it("pins the two breakpoints and the three measures", () => {
    for (const [name, value] of scalars("BREAKPOINT")) {
      expect([name, px(theme[`--breakpoint-${name}`])]).toEqual([name, value]);
    }
    for (const [name, value] of scalars("MEASURE")) {
      expect([name, px(theme[`--container-${name}`])]).toEqual([name, value]);
    }
    // Both namespaces are cleared, so `sm:` (640px) and `max-w-xl` (576px) —
    // neither of which is a contract value — stop compiling.
    expect(theme["--breakpoint-*"]).toBe("initial");
    expect(theme["--container-*"]).toBe("initial");
  });

  it("leaves SPACE to Tailwind's own step, because they are the same 4px", () => {
    // SPACE needs no port — and that claim is the thing worth pinning,
    // because it is what lets `px-4` mean SPACE[4]. If a round ever moves the
    // step off 4px, the port stops being a no-op and this says so.
    for (const [step, value] of scalars("SPACE")) {
      expect([step, value]).toEqual([step, Number(step) * 4]);
    }
  });

  it("declares every T1 colour role, and no raw hex among them", () => {
    // Theme.dc.html T1 is fifteen rows. Task 111 adds the dark column by
    // redefining the variables these point at — which only works if every
    // role is named here and nothing resolves to a literal.
    for (const role of [
      "ground",
      "ink",
      "panel",
      "tint",
      "hairline",
      "hairline-2",
      "muted",
      "quiet",
      "placeholder",
      "photo",
      "dialed-text",
      "cold-text",
      "unread",
      "action",
      "failure",
    ]) {
      expect([role, theme[`--color-${role}`]]).toEqual([
        role,
        `var(--${role})`,
      ]);
    }
    expect(theme["--color-*"]).toBe("initial");
    for (const [name, value] of Object.entries(theme)) {
      if (name.startsWith("--color-")) expect(value).not.toMatch(/#[\da-f]/i);
    }
  });
});
