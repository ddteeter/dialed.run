import path from "node:path";
import { pathToFileURL } from "node:url";

import { z } from "zod";

import type { Scorer } from "../../src/modules/call/contract";
import {
  casesFrom,
  releaseCheck,
  syntheticPersonas,
  type ReplayCase,
} from "../../src/modules/call/replay";
import { SCORER_READS, score } from "../../src/modules/call/scorer";

/**
 * The Call's replay over the seeded personas (sprint lanes A3 and A4):
 *
 *   npx tsx eval/call/run.ts [seed] [tolerance] [baseline]
 *
 * The candidate is always this checkout's scorer, `score`, with the
 * forecast reads it declares (`SCORER_READS`): the same TypeScript the
 * Worker runs. `baseline` is the version it would replace, a module path
 * whose default export is a `Scorer` (a copy of the last released scorer,
 * kept aside). With no baseline the scorer is held to itself, which is
 * how a first version's own numbers are read: every measure is `equal`.
 *
 * Prints the side-by-side report for a PR body and exits 1 when the
 * candidate does worse or cannot be released on these cases. Not a test,
 * like `eval/photos/`: its output is a judgement on a scorer.
 *
 * The personas are synthetic. Their numbers show the harness and the
 * scorer run end to end; they are not evidence about real runners, and
 * nothing is to be tuned against them.
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
    z.coerce.number().int().optional(),
    z.coerce.number().min(0).optional(),
    z.string().optional(),
  ])
  .parse(process.argv.slice(2));

async function main(): Promise<void> {
  const [seed = 1, tolerance = 0, baselinePath] = args;
  const baseline =
    baselinePath === undefined ? score : await scorerAt(baselinePath);
  const cases: ReplayCase[] = syntheticPersonas(seed).flatMap((persona) =>
    casesFrom(persona.history, persona.cohort),
  );
  const { comparison, report } = releaseCheck(
    baseline,
    { scorer: score, reads: SCORER_READS },
    cases,
    tolerance,
  );
  console.log(report.text);
  process.exitCode = comparison.pass ? 0 : 1;
}

await main();
