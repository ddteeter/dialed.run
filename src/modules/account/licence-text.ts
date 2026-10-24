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
  readonly author?: unknown;
  readonly homepage?: unknown;
  readonly repository?: unknown;
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
  const holder = rest
    .replaceAll(/<[^<>]*>|\(https?:[^()]*\)/gu, "")
    .replaceAll(/\s+/gu, " ")
    .replace(/[.,;]$/u, "")
    .trim();
  return holder === "" ? undefined : holder;
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
 * package.json's author as a name: "Name <address> (site)" is "Name", and
 * an address alone is no name.
 */
export function authorOf(author: unknown): string | undefined {
  const raw =
    typeof author === "object" && author !== null && "name" in author
      ? author.name
      : author;
  if (typeof raw !== "string") return undefined;
  const name = String(raw.split(/[<(]/u, 1)[0]).trim();
  const isAddress = !name.includes(" ") && name.includes("@");
  return name === "" || isAddress ? undefined : name;
}

/**
 * A package's project as a web address: its homepage, or its repository,
 * which package.json allows as a git URL, an object holding one, or npm's
 * `owner/repo` shorthand. Anything not `https://` gets no link.
 */
export function projectOf(
  homepage: unknown,
  repository: unknown,
): string | undefined {
  if (typeof homepage === "string" && homepage.startsWith("https://")) {
    return homepage;
  }
  const raw =
    typeof repository === "object" && repository !== null && "url" in repository
      ? repository.url
      : repository;
  if (typeof raw !== "string") return undefined;
  const shorthand = /^(?:github:)?([\w.-]+\/[\w.-]+)$/u.exec(raw);
  if (shorthand !== null) return `https://github.com/${String(shorthand[1])}`;
  const url = raw
    .replace(/^git\+/u, "")
    .replace(/^git:\/\//u, "https://")
    .replace(/^ssh:\/\/git@/u, "https://")
    .replace(/\.git$/u, "");
  return url.startsWith("https://") ? url : undefined;
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
      authorOf(entry.author);
    const project = projectOf(entry.homepage, entry.repository);
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
  readonly homepage?: unknown;
  readonly repository?: unknown;
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
 * "Built with" (design 151): the tools that build the app and do not ship
 * in it, one row each with its licence and project — no licence text and
 * no copyright line, which a licence asks for only on a copy distributed.
 */
export function toolList(tools: readonly Tool[]): readonly ListedPiece[] {
  return tools
    .map((tool) => {
      const project = projectOf(tool.homepage, tool.repository);
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
