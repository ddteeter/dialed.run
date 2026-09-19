import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { secret } from "../secrets";
import { writeReport } from "../write-report";

import { validatedCorpus } from "./corpus";
import { classifyImage } from "../../src/modules/safety/classifier/moderation";
import { reportFor, type Scored } from "./report";

/**
 * The photo screening eval (task 106 §1). `npm run eval:photos`.
 *
 * **Deliberately not a test**, the same call `eval/run.ts` made for D-32
 * and for the same three reasons: it costs an API round trip per photo, it
 * depends on an upstream being up, and its output is a judgement about
 * where to put a threshold rather than a pass or a fail. `vitest.config.ts`
 * collects `test/**` only, so nothing here runs by accident.
 *
 * **What it answers**: how close to flagged does an ordinary running photo
 * get. The packet asks for that before launch rather than after complaints,
 * because the failure it guards against is the one where a runner posts a
 * sports-bra photo and the app quietly hides it from everyone.
 *
 * Run it after putting ~20 photos in `eval/photos/corpus/` matching the
 * names in `corpus.ts`. Missing files are reported and skipped — a partial
 * corpus is a smaller measurement, not a failed run.
 */

const HERE = path.dirname(fileURLToPath(import.meta.url));
const CORPUS_DIR = path.join(HERE, "corpus");

function contentTypeOf(file: string): string {
  if (file.endsWith(".png")) return "image/png";
  if (file.endsWith(".webp")) return "image/webp";
  return "image/jpeg";
}

async function main(): Promise<void> {
  const apiKey = secret("OPENAI_API_KEY");
  const corpus = validatedCorpus();
  const scored: Scored[] = [];

  for (const entry of corpus) {
    const file = path.join(CORPUS_DIR, entry.file);
    if (!existsSync(file)) {
      console.log(`  MISS  ${entry.file} (not in eval/photos/corpus/)`);
      continue;
    }
    try {
      const result = await classifyImage({
        bytes: new Uint8Array(readFileSync(file)),
        contentType: contentTypeOf(entry.file),
        apiKey,
      });
      scored.push({ entry, result });
      console.log(
        `  ok    ${entry.file}  sexual=${result.scores.sexual.toFixed(4)}${result.flagged ? "  FLAGGED" : ""}`,
      );
    } catch (error: unknown) {
      // One photo that fails is not a reason to lose the other nineteen
      // measurements; it is a line in the report and a smaller corpus.
      const why = error instanceof Error ? error.message : String(error);
      scored.push({ entry, result: { error: why } });
      console.log(`  FAIL  ${entry.file}: ${why}`);
    }
  }

  if (scored.length === 0) {
    throw new Error(
      `no photos found in ${CORPUS_DIR} — see eval/photos/corpus.ts for the expected file names`,
    );
  }

  writeReport({
    scriptUrl: import.meta.url,
    markdown: reportFor(scored),
    covered: scored.length,
    total: corpus.length,
    noun: "photos",
  });
}

await main();
