/**
 * Which test files cover each shard's mutants, from main's reports
 * (design 259): the ones `scripts/main-mutation-reports.sh` leaves at
 * `<dir>/<slug>/stryker-incremental.json`, the same reports a PR shard's
 * seed reads. A test file counts when any mutant lists one of its tests in
 * `coveredBy` or `killedBy`.
 *
 * A report is an artifact a run uploaded, so it is `unknown` until parsed.
 * One that is missing or does not parse leaves its shard out of the
 * coverage, and `select.ts` keeps a shard it knows nothing about.
 */
import { readFileSync } from "node:fs";
import path from "node:path";

import { z } from "zod";

import type { Coverage, Shard } from "./select";

const testIds = z.array(z.string()).optional();
const mutantSchema = z.object({ coveredBy: testIds, killedBy: testIds });
const sourceSchema = z.object({ mutants: z.array(mutantSchema) });
const testSchema = z.object({ id: z.string() });
const testFileSchema = z.object({ tests: z.array(testSchema) });

const reportSchema = z.object({
  files: z.record(z.string(), sourceSchema),
  testFiles: z.record(z.string(), testFileSchema),
});

/**
The test files whose tests cover or kill any mutant in the report, or
undefined when it is not a report.
*/
export function coveringTests(report: unknown): Set<string> | undefined {
  const parsed = reportSchema.safeParse(report);
  if (!parsed.success) return undefined;
  const fileOf = new Map<string, string>();
  for (const [file, { tests }] of Object.entries(parsed.data.testFiles)) {
    for (const { id } of tests) fileOf.set(id, file);
  }
  const files = new Set<string>();
  for (const { mutants } of Object.values(parsed.data.files)) {
    for (const { coveredBy = [], killedBy = [] } of mutants) {
      for (const id of [...coveredBy, ...killedBy]) {
        const file = fileOf.get(id);
        if (file !== undefined) files.add(file);
      }
    }
  }
  return files;
}

function readReport(file: string): unknown {
  try {
    return JSON.parse(readFileSync(file, "utf8"));
  } catch {
    return undefined;
  }
}

export function readCoverage(
  directory: string,
  shards: readonly Shard[],
): Coverage {
  const coverage = new Map<string, Set<string>>();
  for (const shard of shards) {
    const file = path.join(directory, shard.slug, "stryker-incremental.json");
    const tests = coveringTests(readReport(file));
    if (tests !== undefined) coverage.set(shard.name, tests);
  }
  return coverage;
}
