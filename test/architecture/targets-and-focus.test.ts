import { describe, expect, it } from "vitest";

import { isInstrumented, repoPath, withoutComments } from "./source-text";

/**
 * Rules 03 and 06 of `design/Accessibility Contract.dc.html`, asked of the
 * markup rather than of the stylesheet.
 *
 * `test/ui/a11y-css.dom.test.tsx` pins what `target` and the focus ring
 * *mean*. Neither that file nor any component test can say **every**
 * tappable thing carries one — happy-dom applies no stylesheet, so a
 * rendered element cannot be measured, and a component test only ever sees
 * the components somebody remembered to write a test for. "Every" is a
 * question about the source, so it is asked of the source.
 *
 * This is the same instrument `routes-stamp-hydration` uses and for the
 * same reason: what is being checked is a property of the whole set, and
 * the set is files.
 */

const sources: Record<string, string> = import.meta.glob(
  [
    "../../src/ui/**/*.tsx",
    "../../src/modules/**/*.tsx",
    "../../src/routes/**/*.tsx",
  ],
  { query: "?raw", import: "default", eager: true },
);

/**
 * Everywhere a tappable thing can be written: `src/ui/`, every module's
 * `components/`, and `src/routes/`.
 *
 * Routes are in scope by the owner's word rather than by the packet's,
 * which put them out of it beyond adding a heading — four of them held an
 * interactive element, two needing padding and two taking the inline
 * exception. D-83 asked and is closed. Two module files predate the
 * `components/` convention and are screens all the same.
 */
function isOwned(path: string): boolean {
  if (path.startsWith("src/ui/") || path.startsWith("src/routes/")) return true;
  return (
    path.includes("/components/") ||
    path.endsWith("auth/auth-page.tsx") ||
    path.endsWith("auth/google-button.tsx")
  );
}

/**
 * Every interactive element's opening tag, with its attributes.
 *
 * Comments are blanked first: three of these files discuss `<a href>` and
 * `<button aria-pressed>` in prose, and a scan of raw source finds the
 * paragraph rather than the element — the same trap `source-text.ts` was
 * extracted to avoid.
 */
const INTERACTIVE = /<(?<tag>button|a|Link|summary|label)(?=[\s/>])/gu;

interface Element {
  readonly path: string;
  readonly tag: string;
  readonly attributes: string;
  readonly body: string;
}

/**
 * `const NAME = "…"` declared at the top level of one file.
 *
 * Six controls reach their class list through one of these rather than
 * writing it at the site, and every one of them has a reason the file
 * states: `TabBar`'s two label constants exist because the tab and the
 * launcher must wear the same treatment, `VERDICT_CHOSEN`/`VERDICT_RESTING`
 * and `CHIP_ON`/`CHIP_OFF` because a chosen chip and a resting one are one
 * control in two states. A scan that could not see through them would
 * force six good constants to be inlined to satisfy a test, which is the
 * rule bending the code rather than the other way round.
 *
 * One level only, and no imports followed: a class list that needs two
 * hops to read is a class list nobody can review.
 */
function constantsIn(code: string): Map<string, string> {
  const found = new Map<string, string>();
  for (const match of code.matchAll(
    /const (?<name>[A-Z]\w*)(?:: [^=]+)? =\s*"(?<value>[^"]*)"/gu,
  )) {
    const { name, value } = match.groups ?? {};
    if (name !== undefined && value !== undefined) found.set(name, value);
  }
  return found;
}

/**
 * The attribute text with every constant it names spliced in, so one
 * question can be asked of both spellings.
 */
function resolved(attributes: string, constants: Map<string, string>): string {
  let text = attributes;
  for (const match of attributes.matchAll(/\b([A-Z]\w*)\b/gu)) {
    const value = constants.get(match[1] ?? "");
    if (value !== undefined) text += ` ${value}`;
  }
  return text;
}

/**
 * The index of the `>` that closes the opening tag starting at `from` —
 * scanning past braces and quoted strings, since an attribute value can
 * hold either (`className={a ? "x" : "y"}`).
 */
const QUOTES = new Set(['"', "'", "`"]);

/**
 * How far `{` and `}` move the nesting depth. Nothing else moves it.
 *
 * A lookup rather than three more `char === …` arms, and a set rather than
 * `char === '"' || char === "'" || …`. Both are here to stop branching on
 * one character three ways, which is the shape two rules fight over:
 * `unicorn/prefer-switch` rejects the if-chain, and
 * `unicorn/no-break-in-nested-loop` rejects the `switch` it asks for,
 * because every `case` ends in a `break` inside this loop. `source-text.ts`
 * already spells its quote check this way.
 */
const DEPTH_DELTA: Readonly<Record<string, number>> = { "{": 1, "}": -1 };

function findTagEnd(source: string, from: number): number {
  let depth = 0;
  let quote = "";
  for (let index = from; index < source.length; index += 1) {
    const char = source.charAt(index);
    if (quote !== "") {
      if (char === quote) quote = "";
    } else if (QUOTES.has(char)) {
      quote = char;
    } else {
      depth += DEPTH_DELTA[char] ?? 0;
      if (char === ">" && depth === 0) return index;
    }
  }
  return source.length;
}

/**
 * The element whose opening tag starts at `from`.
 *
 * `findTagEnd` above returns the index of the closing `>`, which the
 * attribute text stops short of — that boundary is load-bearing, and an
 * earlier mechanical fix that replaced the scan's `return` with
 * `index = source.length` quietly moved it, so every element's attributes
 * gained a `>`. Nothing here noticed, because `target` appears in the
 * className either way.
 */
function elementAt(source: string, tag: string, from: number): Element {
  const index = findTagEnd(source, from);
  const close = source.indexOf(`</${tag}>`, index);
  return {
    path: "",
    tag,
    attributes: source.slice(from, index),
    body: close === -1 ? "" : source.slice(index, close),
  };
}

/**
 * Every element this file's scan owns, extracted to its own function so the
 * per-match `continue` below sits in a single loop rather than one nested
 * inside the per-file loop — `unicorn/no-break-in-nested-loop` reads a
 * `continue` in a nested loop as ambiguous about which loop it means, even
 * though there is only one candidate here.
 */
function elementsIn(path: string, code: string): Element[] {
  const constants = constantsIn(code);
  const found: Element[] = [];
  for (const match of code.matchAll(INTERACTIVE)) {
    const tag = match.groups?.tag ?? "";
    const element = elementAt(code, tag, match.index + match[0].length);
    // **A `<label>` is a target only when it wraps its own control.** The
    // caption above a `FormField`'s box is a `<label htmlFor>` pointing at
    // an input somewhere else — growing that to 44px would put 20px of
    // white space under every field caption in the app. A label the runner
    // can actually tap is one the control is inside of, and that is a fact
    // about the element rather than a list somebody maintains.
    if (
      tag === "label" &&
      !/<(?:input|select|textarea)\b/u.test(element.body)
    ) {
      continue;
    }
    found.push({
      ...element,
      tag,
      path,
      attributes: resolved(element.attributes, constants),
    });
  }
  return found;
}

const elements: Element[] = [];
for (const [globPath, source] of Object.entries(sources)) {
  const path = repoPath(globPath);
  if (!isOwned(path)) continue;
  // Stryker rewrites source in its sandbox and Vite's `?raw` inlines the
  // rewrite, so a mutation run would scan its own instrumentation.
  if (isInstrumented(source)) continue;
  const code = withoutComments(source);
  elements.push(...elementsIn(path, code));
}

describe("03 · every tappable thing has a 44×44 hit area", () => {
  it("found the targets, so nothing below is vacuous", () => {
    // A scanner that matched nothing would make every case pass against an
    // app with no buttons in it. There are more than sixty.
    expect(elements.length).toBeGreaterThan(60);
    expect(
      new Set(elements.map((element) => element.path)).size,
    ).toBeGreaterThan(20);
  });

  it.each(
    elements.map(
      (element) =>
        [element.path, element.attributes.slice(0, 90), element] as const,
    ),
  )("%s %s", (_path, _attributes, element) => {
    // Two answers, and both are a decision somebody wrote down:
    // `target` pads it to 44, `data-target="inline"` claims WCAG 2.5.8's
    // inline exception for a link set in a sentence. There is no third
    // answer, so a new control cannot arrive without one of them.
    const isPadded = /\btarget\b/u.test(element.attributes);
    const isInline = element.attributes.includes('data-target="inline"');
    expect(isPadded || isInline).toBe(true);
  });

  it("keeps the inline exception to links inside running text", () => {
    // Design's round-13 ruling on rule 03: "standalone targets only; a link
    // set in a sentence takes WCAG 2.5.8's inline exception and does not
    // grow the line." A `<button>` is never that — it is a control with a
    // box, wherever it sits — so the exception is for anchors only, and a
    // short list of them.
    const exempt = elements.filter((element) =>
      element.attributes.includes('data-target="inline"'),
    );
    expect(
      exempt
        .map((element) => element.path)
        .toSorted((a, b) => a.localeCompare(b)),
    ).toEqual([
      "src/modules/auth/auth-page.tsx",
      // "Not now — leave it in the queue." (Product Screens A2).
      "src/modules/feed/components/AttachKit.tsx",
      "src/routes/runs/new.tsx",
      "src/ui/ProductLink.tsx",
      "src/ui/WeatherAttribution.tsx",
    ]);
    for (const element of exempt) expect(element.tag).not.toBe("button");
  });
});

describe("06 · the focus ring is never removed", () => {
  it("has no `outline-none` anywhere in src", () => {
    // The utility is what "never removed" looks like when it goes wrong,
    // and it went wrong five times: `TextField` and `ManualRunForm`'s four
    // hand-built fields each said "no ring" with nothing saying where the
    // ring had gone. `field-box` moves it to the box instead, in one
    // declaration block that cannot be half-applied.
    for (const [globPath, source] of Object.entries(sources)) {
      if (isInstrumented(source)) continue;
      expect([repoPath(globPath), withoutComments(source)]).not.toContain(
        "outline-none",
      );
    }
  });

  it("would notice one", () => {
    // The case above can only ever say "absent", so on its own it cannot
    // tell a working scan from one reading an empty string. This is the
    // shape it is looking for.
    expect(withoutComments('className="w-full outline-none"')).toContain(
      "outline-none",
    );
    expect(withoutComments("// outline-none is gone")).not.toContain(
      "outline-none",
    );
  });
});
