import { describe, expect, it } from "vitest";

import { generateStructure } from "../../scripts/diagrams/structure";
import type { StructureInputs } from "../../scripts/diagrams/structure";

const WRANGLER = `{
  // A comment, and a URL that must survive it.
  "vars": { "ORIGIN": "https://dialed.run" },
  "d1_databases": [{ "database_name": "dialed-core" }],
  "r2_buckets": [{ "bucket_name": "dialed-public-photos" },],
  "analytics_engine_datasets": [{ "dataset": "dialed_vitals" }],
  "queues": {
    "producers": [{ "queue": "dialed-imports" }],
    "consumers": [
      {
        "queue": "dialed-imports",
        "max_retries": 3,
        "dead_letter_queue": "dialed-imports-dlq",
      },
      { "queue": "dialed-imports-dlq", "max_retries": 1 },
    ],
  },
}`;

function inputs(overrides: Partial<StructureInputs> = {}): StructureInputs {
  return {
    wranglerJsonc: WRANGLER,
    crons: [],
    sources: {},
    words: {},
    ...overrides,
  };
}

function lines(overrides: Partial<StructureInputs> = {}): string[] {
  return generateStructure(inputs(overrides))
    .split("\n")
    .map((line) => line.trim());
}

describe("generateStructure: what is bound", () => {
  it("draws each database, dataset, bucket and queue from the config", () => {
    const out = lines();

    expect(out).toContain("coreDb = database 'D1: dialed-core'");
    expect(out).toContain(
      "vitalsDataset = database 'Analytics Engine: dialed_vitals'",
    );
    expect(out).toContain(
      "publicPhotosBucket = bucket 'R2: dialed-public-photos'",
    );
    expect(out).toContain("importsQueue = queue 'Queue: dialed-imports'");
    expect(out).toContain("importsDlq = queue 'Queue: dialed-imports-dlq'");
  });

  it("draws a queue once, however many times the config names it", () => {
    const out = lines();

    expect(
      out.filter((line) => line.startsWith("importsQueue =")),
    ).toHaveLength(1);
    expect(out.filter((line) => line.startsWith("importsDlq ="))).toHaveLength(
      1,
    );
  });

  it("draws the dead-letter arrow with the retries the config binds", () => {
    const out = lines();

    expect(out).toContain(
      "cf.importsQueue -[recovery]-> cf.importsDlq 'dead-letters after 3 retries'",
    );
    expect(out.filter((line) => line.includes("-[recovery]->"))).toHaveLength(
      1,
    );
  });

  it("refuses a config without the bindings it reads", () => {
    expect(() => generateStructure(inputs({ wranglerJsonc: "{}" }))).toThrow(
      Error,
    );
  });
});

describe("generateStructure: crons", () => {
  it("names a cron for its firing and keeps the registry's name beside it", () => {
    const out = lines({
      crons: [
        { schedule: "0 12 * * *", name: "daily-digest" },
        { schedule: "30 * * * *", name: "enrichment-retry" },
        { schedule: "5 7 * * *", name: "early" },
      ],
    });

    expect(out).toContain(
      "cronDaily1200 = onCron 'Cron: daily at 12:00 UTC' {",
    );
    expect(out).toContain("technology '0 12 * * * (daily-digest)'");
    expect(out).toContain("cronHourly30 = onCron 'Cron: every hour at :30' {");
    expect(out).toContain("technology '30 * * * * (enrichment-retry)'");
    expect(out).toContain(
      "cronDaily0705 = onCron 'Cron: daily at 07:05 UTC' {",
    );
  });

  it.each(["*/5 * * * *", "0 12 * * 1", "0 */6 * * *", "0 12 1 * *"])(
    "throws on a shape it cannot name: %s",
    (schedule) => {
      expect(() =>
        generateStructure(inputs({ crons: [{ schedule, name: "odd" }] })),
      ).toThrow(`cron shape not drawn: ${schedule}`);
    },
  );
});

const SOURCES = {
  "src/modules/runs/index.ts": `export { startImport } from "./imports";`,
  "src/modules/runs/imports.ts": [
    `import { z } from "zod";`,
    `import {`,
    `  attachObservation,`,
    `  type Observation,`,
    `  cacheKeyFor as keyFor,`,
    `} from "../weather";`,
    `import type { Parsed } from "./parsers";`,
    `import * as schema from "../../db/schema-core";`,
    `// import { never } from "../feed";`,
    `export const text = sql\`select a from "../feed"\`;`,
  ].join("\n"),
  "src/modules/runs/parsers/index.ts": `export { parse } from "./fit";`,
  "src/modules/runs/parsers/fit.ts": [
    `import { runLimits } from "../upload-limits";`,
    `import { timeZoneAt } from "../../weather/provider";`,
  ].join("\n"),
  "src/modules/runs/components/Upload.tsx": `import { Bell } from "../../notifications";`,
  "src/modules/weather/index.ts": `export { attachObservation } from "./attach";`,
  "src/modules/weather/attach.ts": `import { fetchHour } from "./provider";`,
  "src/modules/weather/provider/index.ts": `export const fetchHour = 1;`,
  "src/modules/notifications/index.ts": [
    `import defaults, { a, b, c, d } from "../runs";`,
  ].join("\n"),
  "src/modules/public-pages/index.ts": `export const page = 1;`,
  "src/modules/loose.ts": `import { a } from "./runs";`,
  "src/lib/now.ts": `import { a } from "../modules/runs";`,
};

describe("generateStructure: modules and their imports", () => {
  const out = lines({ sources: SOURCES });

  it("draws a folder with its own index.ts as a module, nested where it sits", () => {
    const text = generateStructure(inputs({ sources: SOURCES }));

    expect(text).toContain(
      [
        "    runs = module 'runs' {",
        "      parsers = module 'runs/parsers'",
        "    }",
      ].join("\n"),
    );
    expect(out).toContain("notifications = module 'notifications'");
    expect(out).toContain("publicPages = module 'public-pages'");
    expect(out.some((line) => line.startsWith("components ="))).toBe(false);
  });

  it("draws one arrow a pair, labelled with the names imported", () => {
    expect(out).toContain(
      "cf.app.runs -[imports]-> cf.app.weather 'attachObservation, cacheKeyFor, Observation'",
    );
    expect(out).toContain(
      "cf.app.runs -[imports]-> cf.app.notifications 'Bell'",
    );
  });

  it("shortens a long label to its first names and a count", () => {
    expect(out).toContain(
      "cf.app.notifications -[imports]-> cf.app.runs 'a, b +3'",
    );
  });

  it("gives a sub-module its own arrows, to the unit that owns the target", () => {
    expect(out).toContain(
      "cf.app.runs.parsers -[imports]-> cf.app.weather.provider 'timeZoneAt'",
    );
  });

  it("draws no arrow between a module and its own sub-module", () => {
    const arrows = out.filter((line) => line.includes("-[imports]->"));

    expect(arrows).toHaveLength(4);
    expect(arrows.some((line) => line.includes("cf.app.feed"))).toBe(false);
  });

  it("gives every module with an arrow a view of its imports", () => {
    expect(out).toContain("view runsImports of cf.app.runs {");
    expect(out).toContain("title 'runs: what it imports, and what imports it'");
    expect(out).toContain("view runsParsersImports of cf.app.runs.parsers {");
    expect(out).toContain(
      "title 'runs/parsers: what it imports, and what imports it'",
    );
    expect(out.some((line) => line.startsWith("view publicPagesImports"))).toBe(
      false,
    );
  });
});

describe("generateStructure: descriptions", () => {
  it("writes a description from the words file, escaped as the formatter does", () => {
    const out = lines({
      words: { "cf.coreDb": "A runner's closet" },
    });

    expect(out).toContain(String.raw`description 'A runner\'s closet'`);
  });

  it("describes a nested module by its full id", () => {
    const out = lines({
      sources: SOURCES,
      words: { "cf.app.runs.parsers": "Reads a run file" },
    });

    expect(out).toContain("parsers = module 'runs/parsers' {");
    expect(out).toContain("description 'Reads a run file'");
  });

  it("throws on a description for something it does not generate", () => {
    expect(() =>
      generateStructure(
        inputs({ words: { "cf.gone": "x", "cf.coreDb": "y" } }),
      ),
    ).toThrow("structure.words.json describes what is not generated: cf.gone");
  });
});
