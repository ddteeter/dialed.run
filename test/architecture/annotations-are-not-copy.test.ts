import { describe, expect, it } from "vitest";

import { isInstrumented, repoPath, withoutComments } from "./source-text";

/**
 * Design's commentary is never the app's copy.
 *
 * The artboards carry two kinds of text in one frame: the screen's own
 * copy, and design's notes *about* it — rulings, reasons, caveats. Round 18
 * marked every note `data-annotation` so the two can be told apart by a
 * machine, and the conformance harness skips them for exactly that reason.
 *
 * **The build had already shipped one.** DS2's backlog rail rendered
 * "Verdicts saved here count exactly like verdicts from the phone. There's
 * no bulk rule — every row is one run." as its body — a note on the
 * Desktop Contract explaining the design to its builders, not something a
 * runner was meant to read. Task 115 lifted it into JSX; the 2026-09-22
 * reconciliation sweep found it, and a scan of all 108 annotation
 * sentences against the source found no second one.
 *
 * So the check is a scan, not a list: every annotation sentence on every
 * board, against every component's code with its comments removed.
 * Comments are removed because quoting design's reasoning in a comment is
 * exactly right — the doc comment on `VerdictBacklog` quotes this very
 * note — and only rendered text is a leak.
 */

const boards: Record<string, string> = import.meta.glob(
  "../../design/*.dc.html",
  { query: "?raw", import: "default", eager: true },
);

const sources: Record<string, string> = import.meta.glob("../../src/**/*.tsx", {
  query: "?raw",
  import: "default",
  eager: true,
});

const ENTITIES: Readonly<Record<string, string>> = {
  "&amp;": "&",
  "&nbsp;": " ",
  "&rsquo;": "’",
  "&lsquo;": "‘",
  "&ldquo;": "“",
  "&rdquo;": "”",
  "&mdash;": "—",
  "&ndash;": "–",
  "&middot;": "·",
  "&rarr;": "→",
};

function decoded(text: string): string {
  return text.replaceAll(/&[a-z]+;/gu, (entity) => ENTITIES[entity] ?? " ");
}

/**
 * Letters and digits only, lower-cased, one space between words — so
 * `There&rsquo;s` in JSX and `There’s` on a board are the same words, and
 * punctuation or a line break in the middle of a sentence is not what
 * makes two texts different.
 */
function words(text: string): string {
  return decoded(text)
    .toLowerCase()
    .replaceAll(/[^\p{L}\p{N}]+/gu, " ")
    .trim();
}

/**
 * Markup removed, with a space where each tag was so words either side of
 * a `<br />` stay two words. A loop rather than a regex: the obvious
 * pattern is flagged for backtracking, and a character scan cannot
 * backtrack at all.
 */
function withoutTags(html: string): string {
  let out = "";
  let isInTag = false;
  for (const char of html) {
    if (char === "<") isInTag = true;
    else if (char === ">") {
      isInTag = false;
      out += " ";
    } else if (!isInTag) out += char;
  }
  return out;
}

const ANNOTATED =
  /<(span|p|div)\b[^>]*\bdata-annotation\b[^>]*>(?<body>[\s\S]*?)<\/\1>/gu;

/**
 * Every annotation sentence of six words or more, as its first eight
 * words. Eight is long enough that two notes do not collide with ordinary
 * UI copy by accident, and short enough to survive a note that goes on to
 * differ from a copy in its tail.
 *
 * **What a note quotes is not the note.** Design rules copy inside its
 * notes by quoting it — round 21's A3 note reads *No kit: "Logged. No kit
 * on this run, so no garment record moved."* — and a quoted sentence is
 * the ruling's words for the screen, which the build is meant to carry.
 * So a double-quoted span is cut out before sentences are keyed, and the
 * commentary around it is what stays checked.
 */
const QUOTED = /"[^"]*"/gu;

function annotationKeys(): Set<string> {
  const keys = new Set<string>();
  for (const html of Object.values(boards)) {
    for (const match of html.matchAll(ANNOTATED)) {
      const text = withoutTags(match.groups?.body ?? "").replaceAll(
        QUOTED,
        ". ",
      );
      for (const sentence of decoded(text).split(/[.!?]\s/u)) {
        const key = words(sentence).split(" ").slice(0, 8);
        if (key.length >= 6) keys.add(key.join(" "));
      }
    }
  }
  return keys;
}

const KEYS = annotationKeys();

describe("design's annotations", () => {
  it("parsed the boards, so the check below is not vacuous", () => {
    // 108 annotation sentences at round 19. A parser that matched nothing
    // would make the scan below pass against no notes at all.
    expect(KEYS.size).toBeGreaterThan(50);
    expect(Object.keys(sources).length).toBeGreaterThan(20);
  });

  it("never appear as rendered text in a component", () => {
    const leaks: string[] = [];
    for (const [path, source] of Object.entries(sources)) {
      if (isInstrumented(source)) continue;
      const rendered = ` ${words(withoutComments(source))} `;
      for (const key of KEYS) {
        if (rendered.includes(` ${key} `))
          leaks.push(`${repoPath(path)}: "${key}…"`);
      }
    }
    expect(leaks).toEqual([]);
  });
});
