/**
 * Every `others` entry in the owner map (`eslint/table-owners.ts`) is used
 * by a write in `src` (owner, 2026-11-26, on #1079). A lane that moves a
 * write and forgets the old writer's line leaves a permission nothing
 * needs, which the rule alone would never report. This lints `src` with a
 * copy of the rule that records each write an entry let through, then
 * lists the entries, kinds and columns no write used.
 *
 * In the `node` project because ESLint reads the files from disk.
 */
import { ESLint } from "eslint";
import tseslint from "typescript-eslint";
import { beforeAll, describe, expect, it } from "vitest";

import { tableOwners, type OwnersEntry } from "../../eslint/table-owners";
import { createTableWrites, type Use } from "../../eslint/table-writes";

/**
 * Linting all of `src` typed is the slowest thing in this project: about
 * 40s here, more on CI's runner. It runs once, under a deadline of its own.
 */
const WHOLE_SRC_MS = 300_000;

const uses: Use[] = [];

beforeAll(async () => {
  const eslint = new ESLint({
    overrideConfigFile: true,
    overrideConfig: [
      {
        files: ["src/**/*.ts", "src/**/*.tsx"],
        languageOptions: {
          parser: tseslint.parser,
          parserOptions: {
            projectService: true,
            tsconfigRootDir: process.cwd(),
          },
        },
        plugins: {
          dialed: {
            rules: {
              "table-writes": createTableWrites((use) => {
                uses.push(use);
              }),
            },
          },
        },
        rules: { "dialed/table-writes": "error" },
      },
    ],
  });
  await eslint.lintFiles(["src/**/*.ts", "src/**/*.tsx"]);
}, WHOLE_SRC_MS);

const entries: readonly (readonly [string, OwnersEntry])[] =
  Object.entries(tableOwners);

/**
 * What the `others` entries allow, one line each: `table area kind`, or
 * `table area update column` for each column an entry lists.
 */
function allowed(): string[] {
  const lines: string[] = [];
  for (const [table, entry] of entries) {
    const writers = Object.entries(entry.others ?? {});
    for (const [area, writer] of writers) {
      if (writer.insert === true) lines.push(`${table} ${area} insert`);
      if (writer.delete === true) lines.push(`${table} ${area} delete`);
      const columns = writer.update ?? [];
      for (const column of columns) {
        lines.push(`${table} ${area} update ${column}`);
      }
    }
  }
  return lines;
}

/**
 * The same lines, for what the writes in `src` used.
 */
function used(): Set<string> {
  const lines = new Set<string>();
  for (const use of uses) {
    const at = `${use.table} ${use.area}`;
    if (use.kind !== "update") lines.add(`${at} ${use.kind}`);
    for (const column of use.columns) lines.add(`${at} update ${column}`);
  }
  return lines;
}

describe("the owner map's other writers", () => {
  it("records the writes it lets through", () => {
    expect(used().size).toBeGreaterThan(0);
  });

  it("lists no kind or column that no write in src uses", () => {
    const inUse = used();
    expect(allowed().filter((line) => !inUse.has(line))).toStrictEqual([]);
  });
});
