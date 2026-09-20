import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import { withoutComments } from "../architecture/source-text";

/**
 * `src/ui/motion.css` against `design/motion.js`.
 *
 * Read off disk and named `.dom.` for the reason `tokens.dom.test.tsx`
 * gives: `?raw` returns an empty string for a `.css` file, because Vite's
 * CSS plugin claims it first — so every assertion here would pass against
 * a file that was never read. The workers pool has no real filesystem;
 * this project runs in Node and does.
 *
 * The doctrine is untyped JS in a read-only archive, so the port cannot be
 * derived from it at build time. This is the next best thing: the same two
 * facts, checked against each other, so importing a design round says
 * which surface moved instead of the app quietly animating last round's.
 */
const read = (path: string): string =>
  readFileSync(new URL(path, import.meta.url), "utf8");

const doctrine = read("../../design/motion.js");
const css = read("../../src/ui/motion.css");

/**
 * The body of a braced block starting at `open` (the index of its `{`).
 */
function bodyAt(source: string, open: number): string {
  let depth = 0;
  for (let index = open; index < source.length; index += 1) {
    const char = source[index];
    if (char === "{") {
      depth += 1;
    } else if (char === "}") {
      depth -= 1;
      if (depth === 0) return source.slice(open + 1, index);
    }
  }
  return "";
}

function blocksOf(source: string, at: RegExp): Map<string, string> {
  const found = new Map<string, string>();
  for (const match of source.matchAll(at)) {
    const name = match[1];
    if (name === undefined) continue;
    found.set(name, bodyAt(source, match.index + match[0].length - 1));
  }
  return found;
}

const utilities = blocksOf(css, /@utility ([\w-]+) \{/g);
const keyframes = blocksOf(css, /@keyframes ([\w-]+) \{/g);

/**
 * `{ instant: 90, quick: 140, … }` / `{ snap: 'cubic-bezier(…)', … }`.
 */
function scalars(name: string, at: RegExp): Map<string, string> {
  const open = doctrine.indexOf(`export const ${name} = {`);
  const body = bodyAt(doctrine, doctrine.indexOf("{", open));
  const found = new Map<string, string>();
  for (const match of body.matchAll(at)) {
    const [, key, value] = match;
    if (key === undefined || value === undefined) continue;
    found.set(key, value);
  }
  return found;
}

const DURATION = scalars("DURATION", /^ {2}(\w+): (\d+),/gm);
const EASING = scalars("EASING", /^ {2}(\w+): '([^'\n]+)',/gm);

/**
 * One row of the per-surface map.
 */
interface Surface {
  move: string;
  duration: string;
  easing: string;
  why: string;
}

const SURFACES = new Map<string, Surface>();
for (const match of doctrine.matchAll(
  /\{ surface: '([^']+)', move: '([^']+)', duration: '([^']+)', easing: '([^']+)',\s*why: '([^']+)' \}/g,
)) {
  const [, surface, move, duration, easing, why] = match;
  if (surface === undefined) continue;
  SURFACES.set(surface, {
    move: move ?? "",
    duration: duration ?? "",
    easing: easing ?? "",
    why: why ?? "",
  });
}

/**
 * The surface each utility implements. Every entry is checked against
 * `SURFACES` below, so a rename in the doctrine fails here rather than
 * quietly detaching a move from its contract.
 */
const BUILT: Readonly<Record<string, string>> = {
  "tab-indicator": "Tab switch",
  "tab-label": "Tab switch",
  "flow-step-forward": "Log flow step",
  "flow-step-back": "Log flow step",
  "bracket-close-start": "Verdict commit",
  "bracket-close-end": "Verdict commit",
  "verdict-lock": "Verdict commit",
  "sheet-motion": "Sheet / drawer",
  "collapsing-row": "Retire a garment",
  "row-press": "Row press",
  "digit-in-up": "Numbers & temps",
  "digit-in-down": "Numbers & temps",
  "digit-out-up": "Numbers & temps",
  "digit-out-down": "Numbers & temps",
  breathe: "Pending / loading",
};

const REDUCED = /@media \(prefers-reduced-motion: reduce\) \{/;

/**
 * The file with its comments and its `:root` blocks removed.
 *
 * What is left is every rule that styles something, which is where a raw
 * ms value or a hand-written curve would be a violation rather than a
 * declaration. Comments go through the scanner `server-functions-are-glue`
 * already uses, rather than a second regex that strips them slightly
 * differently.
 */
function stylingRules(source: string): string {
  let out = withoutComments(source);
  for (;;) {
    const open = out.indexOf(":root {");
    if (open === -1) return out;
    const body = bodyAt(out, out.indexOf("{", open));
    out =
      out.slice(0, open) + out.slice(open + ":root {".length + body.length + 1);
  }
}

/**
 * A utility's declarations with its reduced-motion block removed, so
 * "what this move does" and "what it collapses to" can be asked
 * separately.
 */
function fullMotion(body: string): string {
  const match = REDUCED.exec(body);
  if (match === null) return body;
  const opened = body.indexOf("{", match.index + match[0].length - 1);
  return (
    body.slice(0, match.index) +
    body.slice(opened + bodyAt(body, opened).length + 2)
  );
}

function reducedMotion(body: string): string {
  const match = REDUCED.exec(body);
  if (match === null) return "";
  return bodyAt(body, match.index + match[0].length - 1);
}

/**
 * Whether anything in this CSS moves an element across the screen —
 * declared, transitioned, or animated through a keyframe that translates.
 */
function isTravelling(body: string): boolean {
  // `translate: 0 0` is the opposite of travel: it is how a collapse says
  // "stay where you are". Only a non-zero offset counts.
  for (const match of body.matchAll(/[;{]\s*translate: ([^;\n]{1,60});/gm)) {
    if (!/^0( 0)?$/.test((match[1] ?? "").trim())) return true;
  }
  if (/transition:[^;]*\btranslate\b/.test(body)) return true;
  for (const match of body.matchAll(/animation: ([\w-]+) /g)) {
    const frames = keyframes.get(match[1] ?? "");
    if (frames === undefined) continue;
    if (isTravelling(frames)) return true;
  }
  return false;
}

/**
 * Whether this CSS animates `property`, following its `animation:` through
 * to the keyframes. The distinction matters for the collapse: a reduced
 * block says `animation: reduced-arrive …` and the word "opacity" is a
 * file away, so a reader that stopped at the declaration would accept a
 * block that collapsed to another slide.
 */
function isAnimating(body: string, property: string): boolean {
  for (const match of body.matchAll(/animation: ([\w-]+) /g)) {
    if (keyframes.get(match[1] ?? "")?.includes(property) === true) return true;
  }
  return false;
}

/**
 * The file with its comments and `:root` blocks removed — what is left is
 * every rule that styles something, which is where a raw value would be a
 * violation rather than a declaration.
 */
const rules = stylingRules(css);

describe("the ported Motion Doctrine (design/motion.js)", () => {
  it("parsed the doctrine, so nothing below is vacuous", () => {
    expect([...DURATION].map(([name]) => name)).toEqual([
      "instant",
      "quick",
      "move",
      "reveal",
    ]);
    expect([...EASING].map(([name]) => name)).toEqual([
      "snap",
      "exit",
      "align",
    ]);
    expect(SURFACES.size).toBe(12);
    expect(utilities.size).toBeGreaterThanOrEqual(15);
    expect(keyframes.size).toBeGreaterThanOrEqual(8);
  });

  it("declares every duration and curve, at the doctrine's values", () => {
    for (const [name, ms] of DURATION) {
      expect([name, css]).toContainEqual(
        expect.stringContaining(`--dur-${name}: ${ms}ms;`),
      );
    }
    for (const [name, curve] of EASING) {
      expect([name, css]).toContainEqual(
        expect.stringContaining(`--ease-${name}: ${curve};`),
      );
    }
    // TRAVEL.element, law 3's ceiling for anything that is not a container.
    expect(css).toContain("--travel-element: 24px;");
  });

  it("names a real surface for every move it builds", () => {
    for (const [utility, surface] of Object.entries(BUILT)) {
      expect([utility, SURFACES.has(surface)]).toEqual([utility, true]);
      expect([utility, utilities.has(utility)]).toEqual([utility, true]);
    }
  });

  it("gives each move the duration and curve its surface names", () => {
    // Pending/loading is the exception the doctrine writes out itself:
    // "custom 900", "linear". Everything else reaches for a token.
    const pending = SURFACES.get("Pending / loading");
    expect([pending?.duration, pending?.easing]).toEqual([
      "custom 900",
      "linear",
    ]);
    expect(fullMotion(utilities.get("breathe") ?? "")).toContain(
      "animation: breathe var(--dur-breathe) linear infinite",
    );

    for (const [utility, surface] of Object.entries(BUILT)) {
      if (surface === "Pending / loading") continue;
      const entry = SURFACES.get(surface);
      const body = fullMotion(utilities.get(utility) ?? "");
      // `verdict-lock` is the "then" in "brackets close … **then** the
      // row locks": it carries the surface's duration as a delay, not as
      // its own length.
      const duration =
        utility === "verdict-lock" ? "instant" : (entry?.duration ?? "");
      const easing =
        utility === "verdict-lock" ? "snap" : (entry?.easing ?? "");
      expect([utility, body.includes(`var(--dur-${duration})`)]).toEqual([
        utility,
        true,
      ]);
      expect([utility, body.includes(`var(--ease-${easing})`)]).toEqual([
        utility,
        true,
      ]);
    }
    expect(fullMotion(utilities.get("verdict-lock") ?? "")).toContain(
      "var(--ease-snap) var(--dur-reveal)",
    );
  });

  it("gives the sheet the faster exit the map asks for in prose", () => {
    // The map's `duration`/`easing` columns describe the sheet arriving;
    // the exit is in the move itself, and it is the half most likely to
    // be dropped in a port.
    const sheet = SURFACES.get("Sheet / drawer");
    expect(sheet?.move).toContain("Exits on ease-exit at quick");
    const body = fullMotion(utilities.get("sheet-motion") ?? "");
    expect(body).toContain("translate var(--dur-quick) var(--ease-exit)");
    // A <dialog> cannot animate out at all without these two.
    expect(body).toContain("allow-discrete");
    expect(body).toContain("@starting-style");
  });

  it("collapses every travelling move to an opacity change, per surface", () => {
    // The variables collapse `quick`/`move`/`reveal` to 90ms, and that is
    // only half the rule: a 24px slide at 90ms is still a slide. Each
    // travelling utility has to say what it does instead.
    expect(doctrine).toContain(
      "Every move collapses to a 90ms opacity change.",
    );
    expect(doctrine).toContain("Never reduce to zero");

    const travelling = [...utilities].filter(([, body]) =>
      isTravelling(fullMotion(body)),
    );
    expect(
      travelling.map(([name]) => name).toSorted((a, b) => a.localeCompare(b)),
    ).toEqual([
      "bracket-close-end",
      "bracket-close-start",
      "digit-in-down",
      "digit-in-up",
      "digit-out-down",
      "digit-out-up",
      "flow-step-back",
      "flow-step-forward",
      "sheet-motion",
      "tab-indicator",
    ]);

    for (const [name, body] of travelling) {
      const collapsed = reducedMotion(body);
      expect([name, collapsed === ""]).toEqual([name, false]);
      expect([name, isTravelling(collapsed)]).toEqual([name, false]);
      // Either it changes opacity instead, or — the tab indicator alone —
      // it stops transitioning and lets the label's colour do the work.
      const isHonest =
        collapsed.includes("opacity") ||
        isAnimating(collapsed, "opacity:") ||
        collapsed.includes("transition-property: none");
      expect([name, isHonest]).toEqual([name, true]);
    }
  });

  it("collapses the durations themselves, and never to zero", () => {
    const collapsed = css.slice(css.indexOf("@media (prefers-reduced-motion"));
    for (const name of ["quick", "move", "reveal"]) {
      expect(collapsed).toContain(`--dur-${name}: var(--dur-instant);`);
    }
    // `instant` is what everything collapses *to*, so it is the one that
    // must not be redefined — a zero there is the whole rule undone.
    expect(collapsed).not.toContain("--dur-instant:");
    expect(css).not.toMatch(/--dur-\w+:\s*0m?s/);
  });

  it("types no raw duration or curve outside the token block", () => {
    // "Never type a raw ms value or cubic-bezier into a screen." The
    // declarations are where they are allowed to exist, once each.
    expect(rules).not.toMatch(/\d{1,5}ms/);
    expect(rules).not.toContain("cubic-bezier");
    // The declarations are where they are allowed to exist, once each —
    // the three curves, the four durations, and the breathe loop.
    const declared = withoutComments(css);
    expect(declared.match(/cubic-bezier/g)).toHaveLength(EASING.size);
    expect(declared.match(/\d{1,5}ms;/g)).toHaveLength(DURATION.size + 1);
  });

  it("keeps the NEVER list, including the one that reads as a nicety", () => {
    for (const never of ["scale(", "rotate(", "spring", "bounce", "shimmer"]) {
      expect([never, rules.includes(never)]).toEqual([never, false]);
    }
    // "Scale-on-press is a spring in disguise and it makes crisp type
    // shimmer" — the press is a colour change and nothing else.
    expect(SURFACES.get("Row press")?.move).toContain("No scale");
    expect(fullMotion(utilities.get("row-press") ?? "")).not.toContain("scale");
    // "Anything over 400ms." The breathe loop is a wait, not a move, and
    // the doctrine gives it its own row; nothing else may exceed reveal.
    for (const [, ms] of DURATION) {
      expect(Number(ms)).toBeLessThan(400);
    }
  });

  it("builds no surface the doctrine has not got, and skips the two it says to", () => {
    // "Closet filter" has no utility of its own: items reflow to
    // measured positions, which is a FLIP and therefore JavaScript —
    // `src/ui/use-list-motion.ts`, whose timings come from the same
    // ported tokens. It is still one of the nine this lane builds.
    const built = new Set([...Object.values(BUILT), "Closet filter"]);
    // The stagger is the Call epic's payoff and there is no Call in v1;
    // stillness is the whole of the offline/error surface.
    expect(built.has("Recommendation reveal")).toBe(false);
    expect(SURFACES.get("Offline / error")?.move).toBe(
      "Nothing. Deliberately static.",
    );
    expect(built.has("Offline / error")).toBe(false);
    // Toast / banner is the third, and it is not a decision this file
    // makes: docs/product.md bans a toast outright ("a toast takes the
    // retry away with it when it leaves"), so v1 has no surface to move.
    expect(built.has("Toast / banner")).toBe(false);
    expect([...built].toSorted((a, b) => a.localeCompare(b))).toEqual([
      "Closet filter",
      "Log flow step",
      "Numbers & temps",
      "Pending / loading",
      "Retire a garment",
      "Row press",
      "Sheet / drawer",
      "Tab switch",
      "Verdict commit",
    ]);
  });
});
