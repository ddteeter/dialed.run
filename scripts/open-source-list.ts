/**
 * Writes `src/modules/account/open-source-list.json`: every open-source
 * piece the app ships and the licence it ships under, for `/open-source`
 * (plan C9; round 29 #9: "It's generated, not written").
 *
 * **What "ships" means here.** The runtime dependency tree, read from the
 * lockfile: `package.json`'s `dependencies`, then each package's own
 * `dependencies`, resolved the way Node resolves them. Not peers, not
 * optional platform binaries, and not `@types/*`, which are erased before
 * anything runs. It is a superset of what the bundles hold — a few
 * build-time packages (the router generator, Babel) sit in `dependencies`
 * too — and over-attribution is the safe direction. Reading exactly what
 * the bundles hold needs a licence plugin in `vite.config.ts`, a
 * human-managed file; see design 147.
 *
 * Then the type: `public/fonts/OFL.txt`'s header names each family the app
 * serves, and `src/ui/fonts.css` must declare nothing it does not name.
 *
 * **Run by `prebuild`**, so a release always carries the list its lockfile
 * makes true, and committed, so tests, dev and the mutation sandbox read
 * the same file without generating it. A dependency added without
 * regenerating fails `test/account/open-source-list.test.ts`.
 *
 * TypeScript under `tsx` rather than `.mjs`, for the reason
 * `check-bundle.ts`'s header gives.
 */
import { readdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

import { z } from "zod";

const OUT = path.join("src", "modules", "account", "open-source-list.json");
const FONT_LICENCE = path.join("public", "fonts", "OFL.txt");
const FONT_FACES = path.join("src", "ui", "fonts.css");

interface Piece {
  name: string;
  version?: string;
  licence: string;
  copyright?: string;
  project?: string;
  notice?: string;
  /**
  Its own licence text, where it differs from its group's.
  */
  text?: string;
}

const byText = (a: string, b: string) => a.localeCompare(b);

function readJson(file: string): unknown {
  return JSON.parse(readFileSync(file, "utf8"));
}

/**
 * What this script reads of the lockfile and of a package's manifest,
 * parsed rather than trusted: package.json allows a string or an object
 * for `license`, `repository` and `author`.
 */
const nameList = z.record(z.string(), z.string());
const lockEntry = z.object({ dependencies: nameList.optional() });
const lockSchema = z.object({ packages: z.record(z.string(), lockEntry) });

const optionalText = z.string().optional();
const typed = z.object({ type: z.string() });
const withUrl = z.object({ url: optionalText });
const withName = z.object({ name: optionalText });

const manifestSchema = z.object({
  name: z.string(),
  version: optionalText,
  license: z.union([z.string(), typed]).optional(),
  homepage: optionalText,
  repository: z.union([z.string(), withUrl]).optional(),
  author: z.union([z.string(), withName]).optional(),
});

type Manifest = z.infer<typeof manifestSchema>;

/**
 * The lockfile's install paths, `""` being the app itself, each with the
 * names it depends on at runtime.
 */
function lockPackages(): Map<string, readonly string[]> {
  const lock = lockSchema.parse(readJson("package-lock.json"));
  return new Map(
    Object.entries(lock.packages).map(([key, value]) => [
      key,
      Object.keys(value.dependencies ?? {}),
    ]),
  );
}

function installPath(base: string, name: string): string {
  return base === "" ? `node_modules/${name}` : `${base}/node_modules/${name}`;
}

/**
Where `name` resolves from the package installed at `from`.
*/
function resolve(
  packages: ReadonlyMap<string, readonly string[]>,
  from: string,
  name: string,
): string {
  let base = from;
  while (!packages.has(installPath(base, name))) {
    if (base === "") throw new Error(`${name} does not resolve from ${from}`);
    const parent = base.lastIndexOf("/node_modules/");
    base = parent === -1 ? "" : base.slice(0, parent);
  }
  return installPath(base, name);
}

/**
Every install path the app's runtime dependencies reach.
*/
function runtimeTree(
  packages: ReadonlyMap<string, readonly string[]>,
): string[] {
  const seen = new Set<string>();
  const queue = (packages.get("") ?? []).map((name) =>
    resolve(packages, "", name),
  );
  for (let next = queue.pop(); next !== undefined; next = queue.pop()) {
    if (seen.has(next)) continue;
    seen.add(next);
    const dependencies = packages.get(next) ?? [];
    queue.push(...dependencies.map((name) => resolve(packages, next, name)));
  }
  const all = [...seen];
  return all.filter((at) => !at.includes("node_modules/@types/"));
}

function licenceOf(manifest: Manifest): string {
  const licence = manifest.license;
  if (licence === undefined) {
    throw new Error(`${manifest.name} declares no licence`);
  }
  if (typeof licence !== "string") return licence.type;
  // "SEE LICENSE IN LICENSE.txt": a licence of its own, named for its package.
  return licence.startsWith("SEE LICENSE IN ")
    ? `${manifest.name} licence`
    : licence;
}

/**
 * A package's repository as a web address: package.json allows a git URL,
 * an object holding one, or npm's `owner/repo` shorthand.
 */
function projectOf(manifest: Manifest): string | undefined {
  const { homepage, repository } = manifest;
  if (homepage?.startsWith("https://") === true) return homepage;
  const raw = typeof repository === "object" ? repository.url : repository;
  if (raw === undefined) return undefined;
  const shorthand = /^(?:github:)?([\w.-]+\/[\w.-]+)$/u.exec(raw);
  if (shorthand?.[1] !== undefined) {
    return `https://github.com/${shorthand[1]}`;
  }
  const url = raw
    .replace(/^git\+/u, "")
    .replace(/^git:\/\//u, "https://")
    .replace(/^ssh:\/\/git@/u, "https://")
    .replace(/\.git$/u, "");
  return url.startsWith("https://") ? url : undefined;
}

function fileNamed(dir: string, pattern: RegExp): string | undefined {
  const name = readdirSync(dir)
    .filter((entry) => pattern.test(entry))
    .toSorted(byText)[0];
  return name === undefined
    ? undefined
    : readFileSync(path.join(dir, name), "utf8").replaceAll("\r\n", "\n");
}

/**
 * "Copyright (c) 2015 …", "Copyright 2015 …", "(c) 2015 …" or "© …" —
 * and not a licence's own prose that happens to start with the word
 * ("copyright notice that is included…") or a clause numbered (c).
 */
const COPYRIGHT_LINE =
  /^\s*(?:Copyright\s*(?:\(c\)|©|\d{4})|(?:\(c\)|©)\s*\d{4}|©)/iu;
const PLACEHOLDER = /\[yyyy\]|\{yyyy\}|<year>|\[year\]|\[fullname\]/iu;

function isCopyrightLine(line: string): boolean {
  return COPYRIGHT_LINE.test(line) && !PLACEHOLDER.test(line);
}

/**
 * The holders, from the copyright lines: "Copyright (c) 2015 Meta" is
 * "2015 Meta", and several lines are joined. The page prints a © before it.
 */
function holdersOf(text: string): string | undefined {
  const holders = text
    .split("\n")
    .filter((line) => isCopyrightLine(line))
    .map((line) =>
      line
        .trim()
        .replace(/^copyright\b:?/iu, "")
        .trim()
        .replace(/^(?:\(c\)|©)/iu, "")
        .trim()
        .replace(/\.$/u, ""),
    )
    .filter((holder) => holder !== "");
  return holders.length === 0 ? undefined : holders.join("; ");
}

/**
 * package.json's author, as a name: "Name <address> (site)" is "Name",
 * and an address alone is no name.
 */
function authorOf(manifest: Manifest): string | undefined {
  const author = manifest.author;
  const raw = typeof author === "object" ? author.name : author;
  if (raw === undefined) return undefined;
  const cut = [raw.indexOf("<"), raw.indexOf("(")].filter((at) => at !== -1);
  const name = raw.slice(0, Math.min(raw.length, ...cut)).trim();
  const isAddress = !name.includes(" ") && name.includes("@");
  return name === "" || isAddress ? undefined : name;
}

/**
A title line: "MIT License", "(The MIT License)".
*/
function isTitle(line: string): boolean {
  return line.trim() === "" || (line.length < 40 && /licen[cs]e/iu.test(line));
}

/**
 * The licence's own words: its copyright lines taken out, and the title
 * before them, which says nothing the group's heading does not.
 */
function bodyOf(text: string): string {
  const lines = text.split("\n").filter((line) => !isCopyrightLine(line));
  const start = lines.findIndex((line) => !isTitle(line));
  return start === -1 ? "" : lines.slice(start).join("\n").trim();
}

/**
 * Two texts are the same licence when they say the same words: spacing,
 * case, punctuation and quote marks aside.
 */
function sameWords(text: string): string {
  return text
    .toLowerCase()
    .replaceAll(/[^a-z0-9]+/gu, " ")
    .trim();
}

interface Shipped {
  readonly piece: Piece;
  readonly body: string | undefined;
}

function shippedAt(at: string): Shipped {
  const manifest = manifestSchema.parse(
    readJson(path.join(at, "package.json")),
  );
  const version = manifest.version;
  const licenceText = fileNamed(at, /^(?:licen[cs]e|copying)(?:[.-].*)?$/iu);
  const notice = fileNamed(at, /^notice(?:\.(?:md|txt))?$/iu)?.trim();
  const copyright =
    (licenceText === undefined ? undefined : holdersOf(licenceText)) ??
    authorOf(manifest);
  const project = projectOf(manifest);
  const piece: Piece = {
    name: manifest.name,
    ...(version !== undefined && { version }),
    licence: licenceOf(manifest),
    ...(copyright !== undefined && { copyright }),
    ...(project !== undefined && { project }),
    ...(notice !== undefined && notice !== "" && { notice }),
  };
  const body = licenceText === undefined ? undefined : bodyOf(licenceText);
  return { piece, body: body === "" ? undefined : body };
}

/**
One row per name and version, however many places it is installed.
*/
function packagesShipped(): Shipped[] {
  const byKey = new Map<string, Shipped>();
  for (const at of runtimeTree(lockPackages())) {
    const shipped = shippedAt(at);
    byKey.set(
      `${shipped.piece.name}@${String(shipped.piece.version)}`,
      shipped,
    );
  }
  return [...byKey].map(([, shipped]) => shipped);
}

/**
The wording most of a group's packages ship, and how it reads compared.
*/
function commonBody(
  group: readonly Shipped[],
): { readonly words: string; readonly text: string } | undefined {
  const counts = new Map<string, { count: number; text: string }>();
  for (const { body } of group) {
    if (body === undefined) continue;
    const words = sameWords(body);
    counts.set(words, {
      count: (counts.get(words)?.count ?? 0) + 1,
      text: body,
    });
  }
  const ranked = [...counts];
  const [common] = ranked.toSorted(
    ([wordsA, a], [wordsB, b]) =>
      b.count - a.count || wordsA.localeCompare(wordsB),
  );
  return common === undefined
    ? undefined
    : { words: common[0], text: common[1].text };
}

/**
 * Each licence's text, printed once for its group: the wording most of
 * the group's packages ship. A package whose own file says something else
 * keeps its own text beside its row.
 */
function groupTexts(shipped: readonly Shipped[]): Record<string, string> {
  const texts: Record<string, string> = {};
  const licences = [...new Set(shipped.map(({ piece }) => piece.licence))];
  for (const licence of licences.toSorted(byText)) {
    const group = shipped.filter(({ piece }) => piece.licence === licence);
    const common = commonBody(group);
    if (common === undefined) continue;
    texts[licence] = common.text;
    for (const { piece, body } of group) {
      if (body !== undefined && sameWords(body) !== common.words) {
        piece.text = body;
      }
    }
  }
  return texts;
}

const ENTRY_MARK = " — Copyright ";

/**
 * The fonts, from the licence file served beside them. Its header lists
 * each family as `  Names — Copyright …`, continued by indented lines, one
 * of which may be the project's address.
 */
function fontPieces(lines: readonly string[]): Piece[] {
  const pieces: Piece[] = [];
  const header = lines.slice(
    0,
    lines.findIndex((line) => line.startsWith("====")),
  );
  for (const line of header) {
    const mark = line.indexOf(ENTRY_MARK);
    const last = pieces.at(-1);
    const more = line.trim();
    if (mark !== -1) {
      pieces.push({
        name: line.slice(0, mark).trim(),
        licence: "OFL-1.1",
        copyright: line
          .slice(mark + ENTRY_MARK.length)
          .replace(/^©/u, "")
          .trim(),
      });
    } else if (last !== undefined && line.startsWith(" ".repeat(4))) {
      if (more.startsWith("https://")) last.project = more;
      else last.copyright = `${String(last.copyright)} ${more}`;
    }
  }
  return pieces;
}

/**
Every family `fonts.css` serves is one the licence file names.
*/
function checkFamilies(pieces: readonly Piece[]): void {
  const css = readFileSync(FONT_FACES, "utf8");
  for (const match of css.matchAll(/font-family: "([^"]+)"/gu)) {
    const family = String(match[1]);
    if (pieces.every((piece) => !piece.name.split(", ").includes(family))) {
      throw new Error(
        `${FONT_FACES} serves ${family}, which ${FONT_LICENCE} does not name`,
      );
    }
  }
}

function fontLicenceText(lines: readonly string[]): string {
  const start = lines.findIndex((line) =>
    line.startsWith("SIL OPEN FONT LICENSE"),
  );
  const end = lines.findIndex(
    (line, index) => index > start && line.startsWith("===="),
  );
  if (start === -1 || end === -1) {
    throw new Error(`${FONT_LICENCE}: no licence text`);
  }
  return lines.slice(start, end).join("\n").trim();
}

const fontLines = readFileSync(FONT_LICENCE, "utf8").split("\n");
const type = fontPieces(fontLines);
checkFamilies(type);
const shipped = packagesShipped();
/**
"AGPL-3.0-only" and "AGPL-3.0" are one licence.
*/
function family(id: string): string {
  return id.replace(/-(?:only|or-later)$/u, "");
}

/**
 * A licence no package ships the text of, filled from the copy this repo
 * already carries: a package under the app's own licence (one AGPL
 * package ships no LICENSE file) reads the repo's `LICENSE`.
 */
function withOwnLicence(texts: Record<string, string>): Record<string, string> {
  const own = z
    .object({ license: z.string() })
    .parse(readJson("package.json")).license;
  const missing = shipped
    .map(({ piece }) => piece.licence)
    .filter((licence) => texts[licence] === undefined);
  const filled = { ...texts };
  for (const licence of missing) {
    if (family(licence) === family(own)) {
      filled[licence] = readFileSync("LICENSE", "utf8").trim();
    }
  }
  return filled;
}

const licences = {
  ...withOwnLicence(groupTexts(shipped)),
  "OFL-1.1": fontLicenceText(fontLines),
};
const packages = shipped
  .map(({ piece }) => piece)
  .toSorted(
    (a, b) =>
      a.name.localeCompare(b.name) ||
      String(a.version).localeCompare(String(b.version)),
  );
writeFileSync(
  OUT,
  `${JSON.stringify({ type, packages, licences }, undefined, 2)}\n`,
);
console.log(
  `open-source list: ${String(packages.length)} packages, ${String(type.length)} type families`,
);
