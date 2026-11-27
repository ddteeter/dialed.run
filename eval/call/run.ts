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
 *   npx tsx eval/call/run.ts <baseline> <candidate> [seed] [tolerance] [reads]
 *
 * Each of `baseline` and `candidate` is a module path whose default export
 * is a `Scorer`. `reads` is the candidate's declared forecast reads, comma
 * separated (`feelsLikeC,precipMm`). Prints the side-by-side report for a
 * PR body and exits 1 when the candidate does worse or cannot be released
 * on these cases. Not a test, like `eval/photos/`: its
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

const conditionRead = z.enum(["tempC", "feelsLikeC", "precipMm", "windKph"]);

const args = z
  .tuple([
    z.string(),
    z.string(),
    z.coerce.number().int().optional(),
    z.coerce.number().min(0).optional(),
    z
      .string()
      .transform((list) => list.split(","))
      .pipe(z.array(conditionRead))
      .optional(),
  ])
  .parse(process.argv.slice(2));

async function main(): Promise<void> {
  const [baselinePath, candidatePath, seed = 1, tolerance = 0, reads = []] =
    args;
  const baseline = await scorerAt(baselinePath);
  const candidate = await scorerAt(candidatePath);
  const cases: ReplayCase[] = syntheticPersonas(seed).flatMap((persona) =>
    casesFrom(persona.history, persona.cohort),
  );
  const before = replay(baseline, cases);
  const after = replay(candidate, cases);
  const beforeMetrics = measure(before);
  const afterMetrics = measure(after);
  const comparison = noWorse(beforeMetrics, afterMetrics, { tolerance, reads });
  const report = formatReport(
    {
      engineVersion: before[0]?.result.engineVersion ?? baselinePath,
      metrics: beforeMetrics,
    },
    {
      engineVersion: after[0]?.result.engineVersion ?? candidatePath,
      metrics: afterMetrics,
    },
    comparison,
  );
  console.log(report.text);
  process.exitCode = comparison.pass ? 0 : 1;
}

await main();
