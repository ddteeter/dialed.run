/**
 * `npm run diagrams:generate`: writes
 * `docs/diagrams/structure.generated.c4` (design 229, step 2).
 *
 * Only the reading and the writing are here. What the file says is decided
 * in `scripts/diagrams/structure.ts`, which
 * `test/architecture/diagram-structure.test.ts` runs over the same inputs
 * and compares with the committed file.
 */
import { readdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

import { cronNameFor, cronSchedules } from "../src/modules/ops/crons";
import { generateStructure } from "./diagrams/structure";

const MODULES = "src/modules";
const OUTPUT = "docs/diagrams/structure.generated.c4";
const WORDS = "docs/diagrams/structure.words.json";

const sources: Record<string, string> = {};
const entries = readdirSync(MODULES, { recursive: true, withFileTypes: true });
for (const entry of entries) {
  if (!entry.isFile() || !/\.tsx?$/u.test(entry.name)) continue;
  const file = path.posix.join(
    entry.parentPath.split(path.sep).join("/"),
    entry.name,
  );
  sources[file] = readFileSync(file, "utf8");
}

const words: unknown = JSON.parse(readFileSync(WORDS, "utf8"));

writeFileSync(
  OUTPUT,
  generateStructure({
    wranglerJsonc: readFileSync("wrangler.jsonc", "utf8"),
    crons: cronSchedules.map((schedule) => ({
      schedule,
      name: cronNameFor(schedule) ?? "",
    })),
    sources,
    words,
  }),
);
console.log(`wrote ${OUTPUT}`);
