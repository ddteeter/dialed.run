/**
 * The text work behind `/open-source` (design 151): who holds a
 * package's copyright, what its licence says once that is taken out, and
 * which wording a licence's group prints once (round 29 #9: "the
 * copyright line is that name"; the text "once, inline").
 *
 * **What ships is not decided here.** Vite's `build.license` reports
 * every package an emitted chunk holds a module of, with its licence
 * file's text, and `npm query` describes each one;
 * `scripts/open-source-list.ts` reads both and hands the rows here. No
 * library extracts copyright holders, so this is the part that has to be
 * ours — and the part that is tested against real licence files.
 *
 * Pure: it reads no file, so a test can give it any text.
 */
import type { OpenSourcePiece } from "./open-source-search";

/**
A row as the list file stores it: a piece, under a licence.
*/
export type ListedPiece = OpenSourcePiece & { readonly licence: string };

/**
 * One bundled package: Vite's report of it (name, version, SPDX id, its
 * licence file's text) joined to what npm's manifest says.
 */
export interface Bundled {
  readonly name: string;
  readonly version: string;
  readonly identifier?: string | undefined;
  readonly text?: string | undefined;
  /**
  The author's name, as `normalize-package-data` reads package.json.
  */
  readonly author?: string | undefined;
  /**
  The homepage, which `normalize-package-data` derives from a hosted repository.
  */
  readonly homepage?: string | undefined;
  readonly notice?: string | undefined;
}

const MARK_AT = /copyright|\(c\)|©/iu;
/**
 * The mark itself, matched where `MARK_AT` found it: "Copyright",
 * "Copyright:", "(c)", "©", and any (c) or © after the word.
 */
const MARK = /(?:copyright:?|\(c\)|©)(?:\s*(?:\(c\)|©))*\s*/iu;
/**
 * What follows "copyright" in a licence's own prose, not a holder's name:
 * "COPYRIGHT HOLDERS BE LIABLE", "copyright notice", "Copyright and
 * related rights".
 */
const PROSE =
  /^(?:holders?|owners?|notices?|laws?|and|or|the|statement|licen[cs]e)\b/iu;
const PLACEHOLDER =
  /\[yyyy\]|\{yyyy\}|<year>|\[year\]|\[fullname\]|\[name of/iu;

/**
 * A copyright line's holder, or `undefined` when the line is not one.
 *
 * The mark must be followed by a year, a © or a capitalised name:
 * `Copyright (c) 2015 Meta`, `Copyright Mathias Bynens`, `© 2020 X` are
 * lines, and the licence's own "copyright notice and this permission
 * notice" is not.
 */
export function holderOf(line: string): string | undefined {
  const at = line.search(MARK_AT);
  // What comes before the mark may only be a title (or indent): seroval's
  // file opens `MIT License Copyright (c) 2025 …` on one line.
  const isLine = at !== -1 && isPreamble(line.slice(0, at));
  if (!isLine || PLACEHOLDER.test(line)) return undefined;
  const rest = line.slice(at).replace(MARK, "");
  if (!/^[\d(©\p{Lu}]/u.test(rest) || PROSE.test(rest)) return undefined;
  // A line led by a bare "(c)" is a holder only with a year after it:
  // Apache 2.0's clause "(c) You must retain, in the Source form…" is the
  // licence's third condition, and reading it as a holder dropped it from
  // the text the page prints.
  if (/^\(c\)/iu.test(line.slice(at)) && !/^\d/u.test(rest)) return undefined;
  const holder = withoutBracketed(rest)
    .replaceAll(/\(https?:[^()]*\)/gu, "")
    .replaceAll(/\s+/gu, " ")
    .replace(/[.,;]$/u, "")
    .trim();
  return holder === "" ? undefined : holder;
}

/**
 * A line without what its angle brackets hold: `Name <address>` is
 * `Name `. Cut at each `<` and kept from the `>` that closes it, so no
 * bracket is left to pair up afterwards; one with no partner is dropped
 * and what follows it kept.
 */
function withoutBracketed(line: string): string {
  return line
    .split("<")
    .map((part, index) =>
      index === 0 ? part : part.slice(part.indexOf(">") + 1),
    )
    .join("")
    .replaceAll(">", "");
}

/**
Every holder a licence file names, joined; `undefined` if it names none.
*/
export function holdersOf(text: string): string | undefined {
  const holders = text
    .split("\n")
    .map((line) => holderOf(line))
    .filter((holder) => holder !== undefined);
  return holders.length === 0 ? undefined : holders.join("; ");
}

/**
 * An author's name as a copyright holder: an address alone is no name.
 * `normalize-package-data` has already cut "Name <address> (site)" to
 * "Name", but reads a bare "someone@example.com" as a name.
 */
function holderNamed(author: string | undefined): string | undefined {
  const isAddress = author?.includes("@") === true && !author.includes(" ");
  return author === "" || isAddress ? undefined : author;
}

/**
A page the project row may link to: https only, since it reaches an href.
*/
function linkTo(homepage: string | undefined): string | undefined {
  return homepage?.startsWith("https://") === true ? homepage : undefined;
}

/**
 * The licence a package declares. "SEE LICENSE IN LICENSE.txt" is a
 * licence of its own, named for its package.
 */
export function licenceOf(name: string, identifier: string | undefined) {
  if (identifier === undefined) {
    throw new Error(`${name} declares no licence`);
  }
  return identifier.startsWith("SEE LICENSE IN ")
    ? `${name} licence`
    : identifier;
}

/**
 * A line before the licence's words that says only which licence it is:
 * "MIT License", "(The MIT License)", or camelize's "This software is
 * released under the MIT license:".
 */
function isPreamble(line: string): boolean {
  const trimmed = line.trim();
  return (
    trimmed === "" ||
    (/licen[cs]e/iu.test(trimmed) &&
      (trimmed.length < 40 || (trimmed.length < 80 && trimmed.endsWith(":"))))
  );
}

/**
 * The licence's own words: its copyright lines taken out, and the title
 * or preamble before them, which says nothing the group's heading does
 * not. `undefined` when nothing is left.
 */
export function bodyOf(text: string): string | undefined {
  const lines = text
    .replaceAll("\r\n", "\n")
    .split("\n")
    .filter((line) => holderOf(line) === undefined);
  const start = lines.findIndex((line) => !isPreamble(line));
  return start === -1 ? undefined : lines.slice(start).join("\n").trim();
}

/**
 * Two texts are the same licence when they say the same words: spacing,
 * case, punctuation and quote marks aside.
 */
export function sameWords(text: string): string {
  return text
    .toLowerCase()
    .replaceAll(/[^a-z0-9]+/gu, " ")
    .trim();
}

/**
 * The wording most of a group ships, by `sameWords`; the first such text
 * in the group's order stands for it, and a tie goes to the wording that
 * sorts first.
 */
export function commonBody(
  bodies: readonly (string | undefined)[],
): string | undefined {
  const counts = new Map<string, { count: number; text: string }>();
  for (const body of bodies) {
    if (body === undefined) continue;
    const words = sameWords(body);
    const seen = counts.get(words);
    counts.set(words, {
      count: (seen?.count ?? 0) + 1,
      text: seen?.text ?? body,
    });
  }
  const [common] = [...counts].toSorted(
    ([wordsA, a], [wordsB, b]) =>
      b.count - a.count || wordsA.localeCompare(wordsB),
  );
  return common?.[1].text;
}

/**
 * The licence a row is listed under. A choice of licences ("MIT OR
 * Apache-2.0") that no package ships the text of is the first choice whose
 * text the list has: the recipient may take either, and
 * `@cloudflare/unenv-preset` ships no licence file at all.
 */
function elected(
  licence: string,
  licences: Readonly<Record<string, string>>,
): string {
  if (licences[licence] !== undefined) return licence;
  const choices = licence.replaceAll(/[()]/gu, "").split(" OR ");
  return choices.find((choice) => licences[choice] !== undefined) ?? licence;
}

/**
 * The bundled packages as rows, one per name and version, and each
 * licence's text printed once for its group. A package whose own words
 * differ from its group's keeps them on its row; one that ships no
 * licence file is covered by its group's.
 */
export function shippedList(bundled: readonly Bundled[]): {
  readonly packages: readonly ListedPiece[];
  readonly licences: Readonly<Record<string, string>>;
} {
  const unique = new Map(
    bundled.map((entry) => [`${entry.name}@${entry.version}`, entry]),
  );
  const rows = Array.from(unique.values(), (entry) => {
    const copyright =
      (entry.text === undefined ? undefined : holdersOf(entry.text)) ??
      holderNamed(entry.author);
    const project = linkTo(entry.homepage);
    const notice = entry.notice?.trim();
    const piece: ListedPiece = {
      name: entry.name,
      version: entry.version,
      licence: licenceOf(entry.name, entry.identifier),
      ...(copyright !== undefined && { copyright }),
      ...(project !== undefined && { project }),
      ...(notice !== undefined && notice !== "" && { notice }),
    };
    return {
      piece,
      body: entry.text === undefined ? undefined : bodyOf(entry.text),
    };
  });
  const licences: Record<string, string> = {};
  const declared = new Set(rows.map(({ piece }) => piece.licence));
  for (const licence of declared) {
    const group = rows.filter(({ piece }) => piece.licence === licence);
    const common = commonBody(group.map(({ body }) => body));
    if (common !== undefined) licences[licence] = common;
  }
  const packages = rows.map(({ piece, body }) => {
    const licence = elected(piece.licence, licences);
    // A row with words has a group text: it is one of the group's words.
    const hasOwnWords =
      body !== undefined &&
      sameWords(body) !== sameWords(licences[licence] ?? body);
    return {
      ...piece,
      licence,
      ...(hasOwnWords && { text: body }),
    };
  });
  return {
    packages: packages.toSorted(
      (a, b) =>
        a.name.localeCompare(b.name) ||
        String(a.version).localeCompare(String(b.version)),
    ),
    licences,
  };
}

/**
One tool that builds the app, as `npm query` describes it.
*/
export interface Tool {
  readonly name: string;
  readonly version: string;
  readonly license?: unknown;
  readonly homepage?: string | undefined;
}

/**
 * package.json's licence: an SPDX string, or the older `{ type }` object.
 */
function declaredLicence(name: string, license: unknown): string {
  const raw =
    typeof license === "object" && license !== null && "type" in license
      ? license.type
      : license;
  return licenceOf(name, typeof raw === "string" ? raw : undefined);
}

/**
 * "Tools we build with" (design 151; round 40 #82): the tools that build the app and do not ship
 * in it, one row each with its licence and project — no licence text and
 * no copyright line, which a licence asks for only on a copy distributed.
 */
export function toolList(tools: readonly Tool[]): readonly ListedPiece[] {
  return tools
    .map((tool) => {
      const project = linkTo(tool.homepage);
      return {
        name: tool.name,
        version: tool.version,
        licence: declaredLicence(tool.name, tool.license),
        ...(project !== undefined && { project }),
      };
    })
    .toSorted((a, b) => a.name.localeCompare(b.name));
}

/**
 * The packages a stylesheet carries, from their preserved banners:
 * `/*! tailwindcss v4.3.3 | MIT License | https://tailwindcss.com *\/`.
 * Vite's licence report reads chunks' modules and skips CSS, so the
 * Tailwind base styles compiled into the stylesheet are found this way.
 */
export function cssBanners(
  css: string,
): readonly { readonly name: string; readonly version: string }[] {
  return Array.from(
    css.matchAll(/\/\*!\s*(@?[\w./-]+)\s+v(\d[\w.+-]*)\s*\|/gu),
    (match) => ({
      name: String(match[1]),
      version: String(match[2]),
    }),
  );
}

/**
A rule drawn in text: `-----`, `=====`.
*/
const RULE_LINE = /^[-=_*]{3,}$/u;
/**
 * A line that starts an item of its own: `1.`, `1.2.`, `(a)`, `- `. The
 * files set these on a new line, and so does the page.
 */
const ITEM_LINE = /^(?:\d+(?:\.\d+)*\.?|\([a-z\d]+\)|[-*•])\s/iu;
/**
 * The longest line read as a heading (the font licence's "PREAMBLE"). A
 * longer line in capitals is a disclaimer's sentence.
 */
const HEADING_LENGTH = 40;

const LOWERCASE = /\p{Ll}/u;

/**
 * A paragraph so far that is a heading: one short line in capitals, which
 * a line of ordinary text then follows. A disclaimer in capitals goes on
 * in capitals, so its lines stay one paragraph.
 */
function isHeading(lines: readonly string[], next: string): boolean {
  const [only, ...rest] = lines;
  return (
    only !== undefined &&
    rest.length === 0 &&
    only.length < HEADING_LENGTH &&
    !LOWERCASE.test(only) &&
    LOWERCASE.test(next)
  );
}

/**
 * A licence's text as paragraphs, for the page to wrap (A-12). The files
 * break their lines at about 80 columns; printed as written, each of
 * those lines wrapped again on a phone. So a paragraph is its lines
 * joined; a blank line or a rule ends one; and a numbered or lettered
 * item, or the text after a short heading in capitals, starts one.
 */
export function reflowed(text: string): readonly string[] {
  const paragraphs: string[] = [];
  let lines: string[] = [];
  const close = () => {
    if (lines.length > 0) paragraphs.push(lines.join(" "));
    lines = [];
  };
  for (const raw of text.split("\n")) {
    const line = raw.trim();
    if (line === "" || RULE_LINE.test(line)) {
      close();
      continue;
    }
    if (ITEM_LINE.test(line) || isHeading(lines, line)) close();
    lines.push(line);
  }
  close();
  return paragraphs;
}
