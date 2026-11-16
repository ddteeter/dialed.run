/**
 * `npm run diagrams:generate`: writes
 * `docs/diagrams/structure.generated.c4` (design 229, step 2). With
 * `--check`, which `npm run diagrams:check` runs, it compares instead and
 * fails when the committed file is not what the sources say.
 *
 * Only the reading and the writing are here. What the file says is decided
 * in `scripts/diagrams/structure.ts`; the facts are read in
 * `scripts/diagrams/sources.ts`.
 */
import { readFileSync, writeFileSync } from "node:fs";

import { cronNameFor, cronSchedules } from "../src/modules/ops/crons";
import { readSources } from "./diagrams/sources";
import { generateStructure, mainOf } from "./diagrams/structure";

const OUTPUT = "docs/diagrams/structure.generated.c4";
const WORDS = "docs/diagrams/structure.words.json";

const wranglerJsonc = readFileSync("wrangler.jsonc", "utf8");
const words: unknown = JSON.parse(readFileSync(WORDS, "utf8"));

const generated = generateStructure({
  wranglerJsonc,
  crons: cronSchedules.map((schedule) => ({
    schedule,
    name: cronNameFor(schedule) ?? "",
  })),
  sources: await readSources(mainOf(wranglerJsonc)),
  words,
});

if (process.argv.includes("--check")) {
  if (readFileSync(OUTPUT, "utf8") !== generated) {
    console.error(
      `${OUTPUT} is not what the sources say. Run \`npm run diagrams:generate\` and commit the result.`,
    );
    process.exitCode = 1;
  }
} else {
  writeFileSync(OUTPUT, generated);
  console.log(`wrote ${OUTPUT}`);
}
