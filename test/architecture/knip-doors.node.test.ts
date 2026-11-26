/**
 * Knip over the module doors (design 265, design 261 ruling 16). Knip runs
 * in production mode, where tests are not users, and every name it reports
 * on a door file (a module's or sub-module's `index.ts`, or a
 * `functions.ts`) is a name no source file imports. Each door's reported
 * names must equal its list in `knip-doors.json`, which only shrinks.
 *
 * When this fails on a new name: drop it from the door (a test imports the
 * declaring file instead), or delete the code it names if nothing uses it.
 * Never add it to the pin. When it fails on a name that went away: remove
 * that name from `knip-doors.json`.
 *
 * In the `node` project because knip runs on Node and reads the disk.
 */
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";
import { z } from "zod";

const named = z.array(z.object({ name: z.string() }));

const issueSchema = z.object({
  file: z.string(),
  exports: named,
  nsExports: named,
  types: named,
  nsTypes: named,
});

const reportSchema = z.object({
  issues: z.array(issueSchema),
});

const pinsSchema = z.record(z.string(), z.array(z.string()));

const DOOR = /^src\/modules\/(?:.+\/)?(?:index|functions)\.ts$/;

const run = spawnSync(
  process.execPath,
  [
    "node_modules/knip/bin/knip.js",
    "--production",
    "--include",
    "exports,nsExports,types,nsTypes",
    "--reporter",
    "json",
  ],
  { encoding: "utf8" },
);

function deadDoorNames(stdout: string): Record<string, string[]> {
  const report = reportSchema.parse(JSON.parse(stdout));
  const doors: Record<string, string[]> = {};
  for (const issue of report.issues) {
    const names = [
      ...issue.exports,
      ...issue.nsExports,
      ...issue.types,
      ...issue.nsTypes,
    ].map(({ name }) => name);
    if (DOOR.test(issue.file) && names.length > 0) {
      doors[issue.file] = names;
    }
  }
  return doors;
}

const reported = deadDoorNames(run.stdout);
const pins = pinsSchema.parse(
  JSON.parse(readFileSync("test/architecture/knip-doors.json", "utf8")),
);

describe("knip over the module doors", () => {
  it("runs knip to a report", () => {
    // 0 is a clean report and 1 one with issues; 2 is knip failing to run.
    expect(run.status).toBeOneOf([0, 1]);
  });

  it("reports no new name on a door", () => {
    const added = Object.entries(reported).flatMap(([file, names]) =>
      names
        .filter((name) => !(pins[file] ?? []).includes(name))
        .map((name) => `${file}: ${name}`),
    );
    expect(added).toStrictEqual([]);
  });

  it("pins no name that is gone", () => {
    const gone = Object.entries(pins).flatMap(([file, names]) =>
      names
        .filter((name) => !(reported[file] ?? []).includes(name))
        .map((name) => `${file}: ${name}`),
    );
    expect(gone).toStrictEqual([]);
  });
});
