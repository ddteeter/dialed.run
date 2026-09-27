import { describe, expect, it } from "vitest";

import { isInstrumented, repoPath, withoutComments } from "./source-text";

/**
 * **Every colour is a T1 role** — and one element is not.
 *
 * Task 113 cleared Tailwind's colour namespace so `bg-slate-500` no longer
 * exists, which closed every door but the arbitrary value: `bg-[#FFFFFF]`
 * compiles whatever the theme says. This closes that one too.
 *
 * **The exemption is Google's button, and only it** (round 26 #13:
 * *"data-part="google-button" is exempt from the palette and icon-pack
 * checks, and so is nothing else"*; decision D-49). Its fill, stroke and
 * text are Google's own specs, which the brand guidelines do not let us
 * restyle. They live in one constant beside that button, and that constant
 * is the whole of the exemption: the file is not exempt, and the next hex
 * written in it fails here like any other.
 *
 * Strava's orange button (round 26 #21) is a vendored image, so it needs
 * no exemption from this check.
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
 * A Tailwind utility whose value is a raw colour: `bg-[#fff]`,
 * `in-data-[theme=dark]:text-[#E3E3E3]`, `border-[rgb(0_0_0)]`. Tested
 * against one class token at a time, so it needs no anchoring.
 */
const RAW_COLOUR = /-\[(?:#[\dA-Fa-f]{3,8}\]|rgba?\(|hsla?\()/u;

/**
 * An inline style object written at the element: `style={{ … }}`. The
 * other door past the theme — a colour here is no class at all, so the
 * token scan below never sees it. **What it does not read**: a colour
 * held in a named constant and passed in (the OG cards' `OG_PALETTE`,
 * which the image renderer needs as literals), and a style whose body
 * holds a `}` of its own, such as a template's `${…}`. Both are stated
 * gaps, not closed ones.
 */
const INLINE_STYLE = /style=\{\{[^}]*\}\}/gu;

/**
 * A raw colour inside one: a hex literal, or a colour function.
 */
const STYLE_COLOUR = /#[\dA-Fa-f]{3,8}\b|\b(?:oklch|oklab|rgba?|hsla?)\(/u;

/**
 * Where one class token ends: whitespace, or the quote around a string.
 */
const TOKEN_BREAK = /[\s"'`]+/u;

/**
 * The one sanctioned place: the Google button's class constant.
 */
const GOOGLE_BUTTON = /export const GOOGLE_BUTTON_CLASS =\s*"[^"]*";/u;

const files = Object.entries(sources)
  .map(([globPath, source]) => [repoPath(globPath), source] as const)
  .filter(([, source]) => !isInstrumented(source));

function rawColoursIn(path: string, source: string): string[] {
  const code = withoutComments(source);
  const scanned = path.endsWith("auth/google-button.tsx")
    ? code.replace(GOOGLE_BUTTON, "")
    : code;
  const inClasses = scanned
    .split(TOKEN_BREAK)
    .filter((token) => RAW_COLOUR.test(token));
  const inStyles = (scanned.match(INLINE_STYLE) ?? [])
    .filter((style) => STYLE_COLOUR.test(style))
    .map((style) => style.replaceAll(/\s+/gu, " "));
  return [...inClasses, ...inStyles].map((found) => `${path}: ${found}`);
}

describe("every colour is a T1 role", () => {
  it("found the source, so nothing below is vacuous", () => {
    expect(files.length).toBeGreaterThan(40);
    expect(
      files.some(([path]) => path.endsWith("auth/google-button.tsx")),
    ).toBe(true);
  });

  it("writes no raw colour outside the Google button", () => {
    expect(
      files.flatMap(([path, source]) => rawColoursIn(path, source)),
    ).toEqual([]);
  });

  it("would catch one, including behind a variant and in the Google file", () => {
    expect(
      rawColoursIn("src/ui/X.tsx", 'className="bg-[#FFFFFF] p-4"'),
    ).toEqual(["src/ui/X.tsx: bg-[#FFFFFF]"]);
    expect(
      rawColoursIn("src/ui/X.tsx", 'className="hover:text-[rgb(0_0_0)]"'),
    ).toEqual(["src/ui/X.tsx: hover:text-[rgb(0_0_0)]"]);
    expect(
      rawColoursIn(
        "src/modules/auth/google-button.tsx",
        'const other = "border-[#747775]";',
      ),
    ).toEqual(["src/modules/auth/google-button.tsx: border-[#747775]"]);
  });

  it("would catch one in an inline style, and leaves a colourless style alone", () => {
    expect(
      rawColoursIn("src/ui/X.tsx", '<i style={{ color: "#fff" }} />'),
    ).toEqual(['src/ui/X.tsx: style={{ color: "#fff" }}']);
    expect(
      rawColoursIn(
        "src/ui/X.tsx",
        '<i style={{\n  background: "oklch(0.7 0.1 90)",\n}} />',
      ),
    ).toEqual(['src/ui/X.tsx: style={{ background: "oklch(0.7 0.1 90)", }}']);
    expect(
      rawColoursIn("src/ui/X.tsx", "<i style={{ width: `${pct}%` }} />"),
    ).toEqual([]);
  });

  it("exempts the Google button's constant, and it really holds Google's colours", () => {
    const [, source] =
      files.find(([path]) => path.endsWith("auth/google-button.tsx")) ?? [];
    expect(source).toMatch(GOOGLE_BUTTON);
    const constant = GOOGLE_BUTTON.exec(source ?? "")?.[0] ?? "";
    for (const colour of [
      "bg-[#FFFFFF]",
      "border-[#747775]",
      "text-[#1F1F1F]",
      "in-data-[theme=dark]:bg-[#131314]",
      "in-data-[theme=dark]:border-[#8E918F]",
      "in-data-[theme=dark]:text-[#E3E3E3]",
    ]) {
      expect(constant).toContain(colour);
    }
  });
});
