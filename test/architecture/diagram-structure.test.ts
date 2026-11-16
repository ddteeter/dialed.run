import { describe, expect, it } from "vitest";

import generated from "../../docs/diagrams/structure.generated.c4?raw";
import words from "../../docs/diagrams/structure.words.json";
import { generateStructure } from "../../scripts/diagrams/structure";
import { cronNameFor, cronSchedules } from "../../src/modules/ops/crons";
import wranglerJsonc from "../../wrangler.jsonc?raw";
import { repoPath } from "./source-text";

/**
 * The drawn structure is the bound structure (design 229, step 2).
 *
 * `docs/diagrams/structure.generated.c4` holds the databases, buckets,
 * queues, crons and modules, and the imports between modules. It is
 * committed, so the diagram tools read it without a build, and this test
 * regenerates it from the same inputs and compares. A binding, a cron, a
 * module or a cross-module import that changes without `npm run
 * diagrams:generate` fails here, and the flows that name a removed element
 * then fail `npm run diagrams:check`.
 *
 * Sources arrive through `?raw` because the pool has no filesystem. Under
 * Stryker those are the instrumented copies, which is harmless here:
 * instrumentation rewrites statements, never an `import … from` clause.
 */
const sources: Record<string, string> = import.meta.glob(
  "../../src/modules/**/*.{ts,tsx}",
  { query: "?raw", import: "default", eager: true },
);

describe("docs/diagrams/structure.generated.c4", () => {
  it("is what the generator writes for today's bindings and imports", () => {
    const expected = generateStructure({
      wranglerJsonc,
      crons: cronSchedules.map((schedule) => ({
        schedule,
        name: cronNameFor(schedule) ?? "",
      })),
      sources: Object.fromEntries(
        Object.entries(sources).map(([path, source]) => [
          repoPath(path),
          source,
        ]),
      ),
      words,
    });

    // Run `npm run diagrams:generate` and commit the result.
    expect(generated).toBe(expected);
  });
});
