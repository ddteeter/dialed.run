/**
 * The deployment list is the plan's §2, both ways (#824, design 237): a
 * row added to `docs/launch/deployment-plan.md` without an entry in
 * `src/modules/ops/deployment-config.ts` fails here, and so does an entry
 * the plan does not have, or one whose kind or level disagrees. The plan
 * is read with the markdown parser the legal pages use, not split by hand.
 *
 * `.dev.vars.example` names every listed value too, set or commented out,
 * so a developer copying it sees each one.
 *
 * In the `node` project because it reads the files from disk.
 */
import { readdirSync, readFileSync } from "node:fs";
import { parseEnv } from "node:util";

import type { Nodes, Root, RootContent, Table, TableCell } from "mdast";
import { fromMarkdown } from "mdast-util-from-markdown";
import { gfmTableFromMarkdown } from "mdast-util-gfm-table";
import { gfmTable } from "micromark-extension-gfm-table";
import { describe, expect, it } from "vitest";

import { deploymentConfig } from "../../src/modules/ops/deployment-config";

const SECTION = "2. Vars and secrets";
const PLAN = "docs/launch/deployment-plan.md";
const PENDING = "docs/launch/deployment-plan";

/**
 * A node's text, bold and code spans read as their words.
 */
function textOf(node: Nodes): string {
  if ("value" in node) return node.value;
  return "children" in node
    ? node.children.map((child: Nodes) => textOf(child)).join("")
    : "";
}

/**
 * The table under `## 2. Vars and secrets`, or `undefined` where there is
 * none: a pending addition (`docs/launch/deployment-plan/`) may extend
 * other sections only.
 */
function sectionTableIn(tree: Root): Table | undefined {
  const start = tree.children.findIndex(
    (node) =>
      node.type === "heading" && node.depth === 2 && textOf(node) === SECTION,
  );
  if (start === -1) return undefined;
  const rest: RootContent[] = tree.children.slice(start + 1);
  const nextHeading = rest.findIndex(
    (node) => node.type === "heading" && node.depth === 2,
  );
  const section = nextHeading === -1 ? rest : rest.slice(0, nextHeading);
  return section.find((node): node is Table => node.type === "table");
}

function parsed(path: string): Root {
  return fromMarkdown(readFileSync(path, "utf8"), {
    extensions: [gfmTable()],
    mdastExtensions: [gfmTableFromMarkdown()],
  });
}

/**
 * The plan's §2 table, then each pending addition's (#875): a lane's new
 * value lands as a row in its own file until the docs pass folds it in.
 */
function sectionTables(): Table[] {
  const plan = sectionTableIn(parsed(PLAN));
  if (plan === undefined) throw new Error(`no table under "## ${SECTION}"`);
  const pending = readdirSync(PENDING)
    .filter((name) => name.endsWith(".md") && name !== "README.md")
    .map((name) => sectionTableIn(parsed(`${PENDING}/${name}`)))
    .filter((table) => table !== undefined);
  return [plan, ...pending];
}

/**
 * The names a row's first cell gives, each in its own code span; a var's
 * span carries its production value after `=`.
 */
function namesIn(cell: TableCell): string[] {
  return cell.children
    .filter((node) => node.type === "inlineCode")
    .map((node) => node.value.split("=", 1)[0] ?? "");
}

interface PlanRow {
  readonly name: string;
  readonly kind: string;
  readonly need: string;
}

function rowsOf(table: Table): PlanRow[] {
  const [header, ...rows] = table.children;
  expect(header?.children.map((cell) => textOf(cell))).toStrictEqual([
    "name",
    "kind",
    "required",
    "read by / written by",
    "without it",
  ]);
  return rows.flatMap((row) => {
    const [names, kind, need] = row.children;
    if (names === undefined || kind === undefined || need === undefined) {
      throw new Error("a §2 row with fewer than three cells");
    }
    return namesIn(names).map((name) => ({
      name,
      kind: textOf(kind),
      need: textOf(need),
    }));
  });
}

function planRows(): PlanRow[] {
  return sectionTables().flatMap((table) => rowsOf(table));
}

function byName(a: { name: string }, b: { name: string }): number {
  return a.name.localeCompare(b.name);
}

describe("the deployment list against the plan's §2", () => {
  const plan = planRows();

  it("reads the plan's rows, not nothing", () => {
    // A parse that found no table would pass every comparison below.
    expect(plan.map((row) => row.name)).toContain("TAKEDOWN_SECRET");
    expect(plan.map((row) => row.name)).toContain("STRAVA_CLIENT_SECRET");
  });

  it("names the same values, each once", () => {
    const listed = deploymentConfig.toSorted(byName).map(({ name }) => name);

    expect(new Set(listed).size).toBe(listed.length);
    expect(listed).toStrictEqual(plan.toSorted(byName).map(({ name }) => name));
  });

  it("gives each its kind and level as the plan does", () => {
    expect(
      deploymentConfig
        .map(({ name, kind, need }) => ({ name, kind, need }))
        .toSorted(byName),
    ).toStrictEqual(plan.toSorted(byName));
  });
});

/**
 * `.dev.vars.example`'s assignments, the commented-out ones too: a line
 * that is a `#` before an assignment is a value the developer may set.
 */
function exampleNames(): { active: string[]; named: string[] } {
  const text = readFileSync(".dev.vars.example", "utf8");
  const uncommented = text
    .split("\n")
    .map((line) => (line.startsWith("# ") ? line.slice(2) : line))
    .join("\n");
  return {
    active: Object.keys(parseEnv(text)),
    named: Object.keys(parseEnv(uncommented)),
  };
}

/**
 * Set only locally or in e2e, never in production: none is a §2 row.
 */
const LOCAL_ONLY = new Set([
  // Production's is a var in wrangler.jsonc; locally it is emptied.
  "PUBLIC_PHOTOS_ORIGIN",
  // The model eval's, not the app's (`modules/enrichment/model`).
  "OPENROUTER_API_KEY",
]);

describe("the deployment list against .dev.vars.example", () => {
  const { active, named } = exampleNames();

  it("names every listed value, set or commented out", () => {
    const missing = deploymentConfig
      .map((value) => value.name)
      .filter((name) => !named.includes(name));

    expect(missing).toStrictEqual([]);
  });

  it("sets nothing the list does not know, beyond the local-only values", () => {
    const listed = new Set<string>(deploymentConfig.map((value) => value.name));
    const unknown = active.filter(
      (name) => !listed.has(name) && !LOCAL_ONLY.has(name),
    );

    expect(unknown).toStrictEqual([]);
  });
});
