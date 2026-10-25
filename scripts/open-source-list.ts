/**
 * Writes `src/modules/account/open-source-list.json` for `/open-source`
 * (plan C9; round 29 #9: "It's generated, not written"; design 151).
 *
 * **What ships is what the bundles hold**, and the build says so: Vite's
 * `build.license` (`vite.config.ts`) writes `.vite/license.json` into each
 * environment's output, listing every package an emitted chunk holds a
 * module of, with its licence file's text. Both environments count —
 * the browser's and the Worker's. `npm query` (npm's own tree) adds what
 * Vite leaves out, read through npm's `normalize-package-data`: each
 * package's homepage, author and directory, where a NOTICE file is read. The text work — copyright
 * holders, each licence's wording once — is `account/licence-text.ts`,
 * where it is tested; this file only reads and writes.
 *
 * **"Built with"** is every direct dependency no bundle holds — the
 * devDependencies and build-time tools — credited by name and licence.
 *
 * Then the type: `public/fonts/OFL.txt`'s header names each family the
 * app serves, and `src/ui/fonts.css` must declare nothing it does not name.
 *
 * **Run by `postbuild`**, because the reports exist only after a build. The
 * list stays committed, so tests, dev and the mutation sandbox read the
 * same file without building. Under `CI` a list that a build changes fails:
 * a dependency changed and nobody ran `npm run build` and committed the
 * list. The list is JSON, not a package, so it cannot change what the
 * bundles hold: one build is a fixed point.
 *
 * TypeScript under `tsx` rather than `.mjs`, for the reason
 * `check-bundle.ts`'s header gives.
 */
import { execFileSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

import normalize from "normalize-package-data";
import { z } from "zod";

import {
  cssBanners,
  shippedList,
  toolList,
  type Bundled,
  type ListedPiece,
} from "../src/modules/account/licence-text";

const OUT = path.join("src", "modules", "account", "open-source-list.json");
const REPORTS = ["client", "server"].map((environment) =>
  path.join("dist", environment, ".vite", "license.json"),
);
const FONT_LICENCE = path.join("public", "fonts", "OFL.txt");
const FONT_FACES = path.join("src", "ui", "fonts.css");

function readJson(file: string): unknown {
  return JSON.parse(readFileSync(file, "utf8"));
}

const reportSchema = z.array(
  z.object({
    name: z.string(),
    version: z.string(),
    identifier: z.string().optional(),
    text: z.string().optional(),
  }),
);

/**
 * What this file reads of each installed package, once npm's own
 * `normalize-package-data` has read its package.json: the author cut to a
 * name, and a homepage — derived from the repository where the package is
 * on a known git host. Parsed after normalising, not trusted.
 */
const personSchema = z.object({ name: z.string().optional() });
const nodeSchema = z.object({
  name: z.string().optional(),
  version: z.string().optional(),
  location: z.string(),
  path: z.string(),
  license: z.unknown().optional(),
  // An empty author ("") is left as it is.
  author: z.union([personSchema, z.literal("")]).optional(),
  homepage: z.string().optional(),
});
type InstalledNode = z.infer<typeof nodeSchema>;

const manifestSchema = z.object({
  dependencies: z.record(z.string(), z.string()).default({}),
  devDependencies: z.record(z.string(), z.string()).default({}),
});

/**
 * npm's own tree, asked of the npm that is running this script
 * (`npm run build` sets `npm_execpath`), not of whichever `npm` is first
 * on the PATH.
 */
function installed(): InstalledNode[] {
  const npm = process.env.npm_execpath;
  if (npm === undefined) {
    throw new Error("run this through npm: `npm run generate:open-source`");
  }
  const out = execFileSync(process.execPath, [npm, "query", "*"], {
    encoding: "utf8",
    maxBuffer: 256 * 1024 * 1024,
  });
  return z
    .array(z.record(z.string(), z.unknown()))
    .parse(JSON.parse(out))
    .map((manifest) => {
      normalize(manifest);
      return nodeSchema.parse(manifest);
    });
}

/**
The first file in `dir` whose name matches, as text.
*/
function fileIn(dir: string, pattern: RegExp): string | undefined {
  const name = readdirSync(dir).find((entry) => pattern.test(entry));
  return name === undefined
    ? undefined
    : readFileSync(path.join(dir, name), "utf8").replaceAll("\r\n", "\n");
}

const NOTICE = /^notice(?:\.(?:md|txt))?$/iu;
const LICENCE_FILE = /^(?:licen[cs]e|copying)(?:[.-].*)?$/iu;

const STYLES = path.join("dist", "client", "assets");

/**
 * What the stylesheets carry, which Vite's report does not see (it reads
 * chunks' modules, not CSS): each package a preserved banner names.
 */
function styled(): z.infer<typeof reportSchema> {
  return readdirSync(STYLES)
    .filter((file) => file.endsWith(".css"))
    .flatMap((file) =>
      cssBanners(readFileSync(path.join(STYLES, file), "utf8")),
    )
    .map(({ name, version }) => ({ name, version }));
}

function bundled(nodes: readonly InstalledNode[]): Bundled[] {
  const byKey = new Map(
    nodes.map((node) => [`${String(node.name)}@${String(node.version)}`, node]),
  );
  const reported = REPORTS.flatMap((report) => {
    if (!existsSync(report)) {
      throw new Error(`${report} is missing: run this after \`vite build\``);
    }
    return reportSchema.parse(readJson(report));
  });
  return [...reported, ...styled()].map((entry) => {
    const node = byKey.get(`${entry.name}@${entry.version}`);
    if (node === undefined) {
      throw new Error(
        `${entry.name}@${entry.version} is bundled but not installed`,
      );
    }
    return {
      ...entry,
      identifier:
        entry.identifier ??
        (typeof node.license === "string" ? node.license : undefined),
      text: entry.text ?? fileIn(node.path, LICENCE_FILE)?.trim(),
      author: node.author === "" ? undefined : node.author?.name,
      homepage: node.homepage,
      notice: fileIn(node.path, NOTICE),
    };
  });
}

/**
Every direct dependency no bundle holds, as installed at the top level.
*/
function tools(
  nodes: readonly InstalledNode[],
  shipped: ReadonlySet<string>,
): readonly ListedPiece[] {
  const manifest = manifestSchema.parse(readJson("package.json"));
  const direct = new Set([
    ...Object.keys(manifest.dependencies),
    ...Object.keys(manifest.devDependencies),
  ]);
  return toolList(
    nodes.flatMap(({ name, version, ...node }) =>
      name !== undefined &&
      version !== undefined &&
      direct.has(name) &&
      !shipped.has(name) &&
      node.location === `node_modules/${name}`
        ? [{ ...node, name, version }]
        : [],
    ),
  );
}

const ENTRY_MARK = " — Copyright ";

interface FontPiece {
  name: string;
  licence: string;
  copyright: string;
  project?: string;
}

/**
 * The fonts, from the licence file served beside them. Its header lists
 * each family as `  Names — Copyright …`, continued by indented lines, one
 * of which may be the project's address.
 */
function fontPieces(lines: readonly string[]): FontPiece[] {
  const pieces: FontPiece[] = [];
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
      else last.copyright = `${last.copyright} ${more}`;
    }
  }
  return pieces;
}

/**
Every family `fonts.css` serves is one the licence file names.
*/
function checkFamilies(pieces: readonly FontPiece[]): void {
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

const nodes = installed();
const { packages, licences } = shippedList(bundled(nodes));
const list = {
  type,
  packages,
  tools: tools(nodes, new Set(packages.map((piece) => piece.name))),
  licences: { ...licences, "OFL-1.1": fontLicenceText(fontLines) },
};
const written = `${JSON.stringify(list, undefined, 2)}\n`;
const before = existsSync(OUT) ? readFileSync(OUT, "utf8") : "";
writeFileSync(OUT, written);
console.log(
  `open-source list: ${String(packages.length)} packages shipped, ${String(list.tools.length)} tools, ${String(type.length)} type families`,
);
if (written !== before && process.env.CI !== undefined) {
  throw new Error(
    `${OUT} was out of date: a dependency changed. Run \`npm run build\` and commit the list.`,
  );
}
