import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import { withoutComments } from "../architecture/source-text";

/**
 * **Every duration and easing comes from the Motion Doctrine.**
 *
 * `design/motion.js` is ported to `src/ui/motion.css` (the `--dur-*` /
 * `--ease-*` vars) and `src/ui/motion.ts` (`DURATION` / `EASING`). Those two
 * files are where a raw `ms` value or a `cubic-bezier(` may be written;
 * everywhere else uses the tokens, so the doctrine's NEVER list (nothing
 * over 400ms, no overshoot) is checked in one place. Comments are not code:
 * a paragraph quoting "breathes after 300ms" is fine.
 */

/**
 * Read from disk, not through `import.meta.glob(…?raw)`: Vite hands a `.css`
 * file to a test as an empty string, which is why this lives in the `ui`
 * project (Node) rather than with the architecture tests (workerd, no fs).
 */
// `import.meta.url` as a string: happy-dom replaces the global `URL`, and
// node:url rejects its instances.
const SRC = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../src",
);
const sources: [string, string][] = readdirSync(SRC, { recursive: true })
  .map(String)
  .filter((rel) => /\.(?:tsx?|css)$/u.test(rel) && !rel.includes(".test."))
  .filter((rel) => rel !== "routeTree.gen.ts")
  .map((rel) => [`src/${rel}`, readFileSync(path.join(SRC, rel), "utf8")]);

const TOKEN_HOMES = new Set(["src/ui/motion.css", "src/ui/motion.ts"]);

/**
 * A raw motion value: `cubic-bezier(`, or a number with an `ms` or `s` unit
 * — `200ms`, `duration-[200ms]`, `0.2s`. The look-behind keeps `h2s` or a
 * `--dur-90ms` name from counting.
 */
const RAW_MOTION = /cubic-bezier\(|(?<![\w.-])\d+(?:\.\d+)?m?s\b/gu;

function rawMotionIn(path: string, source: string): string[] {
  return Array.from(
    withoutComments(source).matchAll(RAW_MOTION),
    (match) => `${path}: ${match[0]}`,
  );
}

const files = sources.filter(([path]) => !TOKEN_HOMES.has(path));

describe("motion values come from the doctrine's tokens", () => {
  it("found the source, CSS included, so nothing below is vacuous", () => {
    expect(files.length).toBeGreaterThan(40);
    expect(files.some(([path]) => path === "src/styles.css")).toBe(true);
    const home = sources.find(([path]) => path === "src/ui/motion.css");
    // The token home itself is full of raw values, so scanning it proves the
    // CSS reaches this test as text and the pattern reads it.
    expect(rawMotionIn("src/ui/motion.css", home?.[1] ?? "")).not.toEqual([]);
  });

  it("writes no raw duration or easing outside motion.css / motion.ts", () => {
    expect(
      files.flatMap(([path, source]) => rawMotionIn(path, source)),
      "use --dur-*/--ease-* or DURATION/EASING from ui/ (see .claude/rules/ui.md §Motion)",
    ).toEqual([]);
  });

  it("would catch one in CSS, in a class and in a style, but not in a comment", () => {
    expect(rawMotionIn("a.css", ".x { transition: opacity 200ms; }")).toEqual([
      "a.css: 200ms",
    ]);
    expect(rawMotionIn("a.tsx", 'className="duration-[150ms]"')).toEqual([
      "a.tsx: 150ms",
    ]);
    expect(
      rawMotionIn(
        "a.tsx",
        'style={{ transition: "all 0.3s cubic-bezier(1,0,0,1)" }}',
      ),
    ).toEqual(["a.tsx: 0.3s", "a.tsx: cubic-bezier("]);
    expect(rawMotionIn("a.tsx", "// breathes after 300ms\n/* 90ms */")).toEqual(
      [],
    );
    expect(
      rawMotionIn("a.css", "transition: opacity var(--dur-quick);"),
    ).toEqual([]);
  });
});
