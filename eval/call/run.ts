import path from "node:path";
import { pathToFileURL } from "node:url";

import { z } from "zod";

import type { Scorer } from "../../src/modules/call/contract";
import {
  casesFrom,
  formatReport,
  measure,
  noWorse,
  replay,
  syntheticPersonas,
  type ReplayCase,
} from "../../src/modules/call/replay";

/**
 * The Call's replay over the seeded personas (sprint lane A3):
 *
 *   npx tsx eval/call/run.ts <baseline> <candidate> [seed] [tolerance]
 *
 * Each of `baseline` and `candidate` is a module path whose default export
 * is a `Scorer`. Prints the side-by-side report for a PR body and exits 1
 * when the candidate does worse. Not a test, like `eval/photos/`: its
 * output is a judgement on a scorer, and it imports whatever it is given.
 */

const scorerModule = z.object({
  default: z.custom<Scorer>((value) => typeof value === "function", {
    message: "the default export must be a Scorer function",
  }),
});

async function scorerAt(modulePath: string): Promise<Scorer> {
  const url = pathToFileURL(path.resolve(modulePath)).href;
  const loaded: unknown = await import(url);
  return scorerModule.parse(loaded).default;
}

const args = z
  .tuple([
    z.string(),
    z.string(),
    z.coerce.number().int().optional(),
    z.coerce.number().min(0).optional(),
  ])
  .parse(process.argv.slice(2));

async function main(): Promise<void> {
  const [baselinePath, candidatePath, seed = 1, tolerance = 0] = args;
  const baseline = await scorerAt(baselinePath);
  const candidate = await scorerAt(candidatePath);
  const cases: ReplayCase[] = syntheticPersonas(seed).flatMap((persona) =>
    casesFrom(persona.history, persona.cohort),
  );
  const before = replay(baseline, cases);
  const after = replay(candidate, cases);
  const beforeMetrics = measure(before);
  const afterMetrics = measure(after);
  const comparison = noWorse(beforeMetrics, afterMetrics, tolerance);
  console.log(
    formatReport(
      {
        engineVersion: before[0]?.result.engineVersion ?? baselinePath,
        metrics: beforeMetrics,
      },
      {
        engineVersion: after[0]?.result.engineVersion ?? candidatePath,
        metrics: afterMetrics,
      },
      comparison,
    ),
  );
  process.exitCode = comparison.pass ? 0 : 1;
}

await main();
