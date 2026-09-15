import { writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { CORPUS } from "./corpus";
import { extractEveryWay, type ModelChoice, type PageExtractions } from "./extractions";
import { fetchPage } from "./page-cache";
import { reportFor } from "./report";
import { secret } from "./secrets";

/**
 * The extraction eval (D-32). `npm run eval`.
 *
 * **Deliberately not a test.** It costs money, it depends on twenty shops
 * being up, and its answer is a judgement rather than a pass or a fail —
 * three things that make a CI check a liability. `vitest.config.ts` only
 * collects `test/**`, so nothing here runs by accident.
 *
 * **Mid-tier models, plus one expensive one as a ceiling.** The question is
 * not "which is best" but "how much accuracy does the deterministic path
 * leave on the table, and does a cheap model recover it". A page is about
 * five thousand tokens, so a full pass over the corpus costs cents at these
 * prices; the ceiling model is there to show what is being given up, not as
 * a candidate.
 */

/**
 * Cheap models only, and every provider here was checked to honour
 * `structured_outputs` before it was written down — which is not a
 * formality: of the fifteen endpoints serving `qwen3.8-27b`, two (Novita
 * and Alibaba) do not, and one of those is the provider you would pick by
 * name. That is the second measured instance of the hazard `openrouter.ts`
 * pins against, after Amazon Bedrock's endpoint for `gpt-5.6-luna`.
 */
const MODELS: readonly ModelChoice[] = [
  { id: "openai/gpt-5.6-luna", provider: "OpenAI" },
  { id: "qwen/qwen3.8-flash", provider: "Alibaba" },
  { id: "qwen/qwen3.8-27b", provider: "Darkbloom" },
];

async function main(): Promise<void> {
  const firecrawl = secret("FIRECRAWL_API_KEY");
  const openrouter = secret("OPENROUTER_API_KEY");

  const pages: PageExtractions[] = [];
  for (const entry of CORPUS) {
    try {
      const html = await fetchPage(entry.url, firecrawl);
      pages.push(
        await extractEveryWay({ ...entry, html }, MODELS, openrouter),
      );
      console.log(`  ok    ${entry.brand} — ${entry.category}`);
    } catch (error: unknown) {
      // A shop that is down is not a reason to lose the other nineteen
      // measurements; it is a line in the log and a smaller corpus.
      const why = error instanceof Error ? error.message : String(error);
      console.log(`  SKIP  ${entry.brand} — ${entry.category}: ${why}`);
    }
  }

  const here = path.dirname(fileURLToPath(import.meta.url));
  const out = path.join(here, "results.md");
  writeFileSync(out, reportFor(pages), "utf8");
  console.log(`\n${String(pages.length)} of ${String(CORPUS.length)} pages -> ${out}`);
}

await main();
