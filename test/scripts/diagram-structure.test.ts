import { describe, expect, it } from "vitest";

import { generateStructure } from "../../scripts/diagrams/structure";
import type { StructureInputs } from "../../scripts/diagrams/structure";

const WRANGLER = `{
  // A comment, and a URL that must survive it.
  "main": "src/server.ts",
  "vars": { "ORIGIN": "https://dialed.run" },
  "send_email": [{ "name": "EMAIL" }],
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

const TSCONFIG = `{
  "compilerOptions": {
    // Two prefixes for one folder, as the repo has.
    "paths": { "#/*": ["./src/*"], "@/*": ["./src/*"] },
  },
}`;

const MAIN = {
  "src/server.ts": [
    `import { handle } from "./modules/runs";`,
    `/*`,
    `export class Retired {}`,
    `*/`,
    `export default {`,
    `  /*`,
    `  email(message) {},`,
    `  */`,
    `  async fetch(request) {`,
    `    const options = {`,
    `      retry(x) {},`,
    `    };`,
    `    return handle(request, options);`,
    `  },`,
    `  queue: drain,`,
    `  scheduled,`,
    `};`,
  ].join("\n"),
};

function inputs(overrides: Partial<StructureInputs> = {}): StructureInputs {
  return {
    wranglerJsonc: WRANGLER,
    tsconfigJsonc: TSCONFIG,
    crons: [],
    words: {},
    ...overrides,
    sources: { ...MAIN, ...overrides.sources },
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
    expect(out).toContain("emailSending = external 'Email sending: EMAIL'");
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
    `} from "../weather";`,
    `import type { Parsed } from "./parsers";`,
    `import * as schema from "../../db/schema-core";`,
    `// import { never } from "../feed";`,
    `// createServerFn( lives in functions.ts`,
    `export const text = sql\`select a from "../feed"\`;`,
  ].join("\n"),
  "src/modules/runs/functions.ts": [
    `import { requireUserId } from "../auth";`,
    `import { attachObservation } from "../weather";`,
    `export const startFn = createServerFn({ method: "POST" });`,
  ].join("\n"),
  "src/modules/runs/parsers/index.ts": `export { parse } from "./fit";`,
  "src/modules/runs/parsers/fit.ts": [
    `import { runLimits } from "../upload-limits";`,
    `import { timeZoneAt } from "../../weather/provider";`,
  ].join("\n"),
  "src/modules/runs/components/Upload.tsx": `import { Bell } from "../../notifications";`,
  "src/modules/auth/index.ts": `export const requireUserId = 1;`,
  "src/modules/weather/index.ts": `export { attachObservation } from "./attach";`,
  "src/modules/weather/attach.ts": `import { fetchHour } from "./provider";`,
  "src/modules/weather/provider/index.ts": `export const fetchHour = 1;`,
  "src/modules/notifications/index.ts": `import defaults, { a } from "../runs";`,
  "src/modules/public-pages/index.ts": `export const page = 1;`,
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

  it("draws one unlabelled arrow a pair where service code imports", () => {
    expect(out).toContain("cf.app.runs -[imports]-> cf.app.weather");
    expect(out).toContain("cf.app.notifications -[imports]-> cf.app.runs");
  });

  it("draws a pair only the server functions and components import as wiring", () => {
    expect(out).toContain("cf.app.runs -[wiring]-> cf.app.auth");
    expect(out).toContain("cf.app.runs -[wiring]-> cf.app.notifications");
  });

  it("gives a sub-module its own arrows, to the unit that owns the target", () => {
    expect(out).toContain(
      "cf.app.runs.parsers -[imports]-> cf.app.weather.provider",
    );
  });

  it("draws nothing for a sub-module, a comment, a query or a file outside a module", () => {
    const arrows = out.filter((line) =>
      /-\[(?:imports|wiring)\]->/u.test(line),
    );

    expect(arrows).toHaveLength(5);
    expect(arrows.some((line) => line.includes("cf.app.feed"))).toBe(false);
  });

  it("gives every module with an arrow a view of both kinds of import", () => {
    expect(out).toContain("view runsImports of cf.app.runs {");
    expect(out).toContain("title 'runs: what it imports, and what imports it'");
    expect(out).toContain(
      "include cf.app.runs -> cf.app.** where kind is imports or kind is wiring",
    );
    expect(out).toContain(
      "include cf.app.** -> cf.app.runs where kind is imports or kind is wiring",
    );
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

describe("generateStructure: every way of importing", () => {
  const sources = {
    "src/modules/feed/index.ts": [
      `import { a } from "@/modules/runs";`,
      `import { b } from "#/modules/weather/provider";`,
      `import { c } from "@tanstack/react-start";`,
      `import "../auth/register";`,
      `const d = await import("../products");`,
      `type E = import("../closet").Garment;`,
      `const f = await import("@cf-wasm/photon/workerd");`,
      "const g = `${String(count)} import(s) stalled`;",
    ].join("\n"),
    "src/modules/runs/index.ts": "export const a = 1;",
    "src/modules/weather/index.ts": "export const w = 1;",
    "src/modules/weather/provider/index.ts": "export const b = 1;",
    "src/modules/auth/index.ts": "export const r = 1;",
    "src/modules/products/index.ts": "export const d = 1;",
    "src/modules/closet/index.ts": "export type Garment = 1;",
  };
  const out = lines({ sources });

  it("resolves both of tsconfig's aliases to the unit they point into", () => {
    expect(out).toContain("cf.app.feed -[imports]-> cf.app.runs");
    expect(out).toContain("cf.app.feed -[imports]-> cf.app.weather.provider");
  });

  it("reads a bare import, a dynamic import and an import type", () => {
    expect(out).toContain("cf.app.feed -[imports]-> cf.app.auth");
    expect(out).toContain("cf.app.feed -[imports]-> cf.app.products");
    expect(out).toContain("cf.app.feed -[imports]-> cf.app.closet");
  });

  it("draws nothing for a package, nor for prose that looks like a call", () => {
    expect(
      out.filter((line) => /-\[(?:imports|wiring)\]->/u.test(line)),
    ).toHaveLength(5);
  });

  it("throws on a dynamic import whose target it cannot read", () => {
    expect(() =>
      generateStructure(
        inputs({
          sources: {
            "src/modules/feed/index.ts":
              "const m = await import(`../${name}`);",
          },
        }),
      ),
    ).toThrow(
      "an import the diagram cannot read, in src/modules/feed/index.ts: import(`",
    );
  });

  it.each([
    [`{ "lib": ["./src/lib/*"] }`, "lib"],
    [`{ "~/*": ["./src/*", "./test/*"] }`, "~/*"],
    [`{ "x/*": ["src/*"] }`, "x/*"],
  ])(
    "throws on a tsconfig path it cannot read as a prefix: %s",
    (paths, name) => {
      expect(() =>
        generateStructure(
          inputs({
            tsconfigJsonc: `{ "compilerOptions": { "paths": ${paths} } }`,
          }),
        ),
      ).toThrow(`tsconfig path not read: ${name}`);
    },
  );

  it("reads a tsconfig with no paths", () => {
    expect(() =>
      generateStructure(inputs({ tsconfigJsonc: `{ "compilerOptions": {} }` })),
    ).not.toThrow();
  });
});

const UNLISTED = "has what the diagram neither draws nor lists";

describe("generateStructure: the ways in are closed lists", () => {
  it.each(["kv_namespaces", "durable_objects", "env"])(
    "throws on a wrangler.jsonc key it neither draws nor lists: %s",
    (key) => {
      const wranglerJsonc = WRANGLER.replace("{", () => `{ "${key}": {},`);

      expect(() => generateStructure(inputs({ wranglerJsonc }))).toThrow(
        `wrangler.jsonc ${UNLISTED}: ${key}.`,
      );
    },
  );

  it("reads main's handlers at the formatter's indent, past comments", () => {
    expect(() => generateStructure(inputs())).not.toThrow();
  });

  it.each([
    ["a new handler", "  async email(message) {},", "email"],
    ["a property handler", "  tail: onTail,", "tail"],
  ])("throws on %s on main", (_name, line, handler) => {
    const main = MAIN["src/server.ts"].replace(
      "export default {",
      () => `export default {\n${line}`,
    );

    expect(() =>
      generateStructure(inputs({ sources: { "src/server.ts": main } })),
    ).toThrow(`src/server.ts ${UNLISTED}: ${handler}.`);
  });

  it("throws on another export from main, such as a Durable Object's class", () => {
    const main = `${MAIN["src/server.ts"]}\nexport class Room {}`;

    expect(() =>
      generateStructure(inputs({ sources: { "src/server.ts": main } })),
    ).toThrow(`src/server.ts ${UNLISTED}: export class Room {}.`);
  });

  it("throws when main has no default export object to read", () => {
    expect(() =>
      generateStructure(
        inputs({ sources: { "src/server.ts": "export default app;" } }),
      ),
    ).toThrow("main has no `export default {`");
  });

  it("throws when main is not among the sources", () => {
    const wranglerJsonc = WRANGLER.replace("src/server.ts", "src/worker.ts");

    expect(() => generateStructure(inputs({ wranglerJsonc }))).toThrow(
      "wrangler.jsonc's main, src/worker.ts, is not a source read",
    );
  });

  it("throws on code in a folder beside src/modules it does not list", () => {
    expect(() =>
      generateStructure(
        inputs({
          sources: {
            "src/lib/now.ts": "export const now = 1;",
            "src/jobs/sweep.ts": "export const sweep = 1;",
          },
        }),
      ),
    ).toThrow(`src ${UNLISTED}: jobs.`);
  });
});

describe("generateStructure: every module file is placed", () => {
  it.each([["src/modules/loose.ts"], ["src/modules/new-thing/service.ts"]])(
    "throws on a file in no module: %s",
    (path) => {
      expect(() =>
        generateStructure(inputs({ sources: { ...SOURCES, [path]: "" } })),
      ).toThrow(`in no module, so not drawn: ${path}.`);
    },
  );

  it("throws on a server function outside functions.ts", () => {
    const path = "src/modules/runs/service.ts";

    expect(() =>
      generateStructure(
        inputs({
          sources: {
            ...SOURCES,
            [path]: `export const f = createServerFn({ method: "GET" });`,
          },
        }),
      ),
    ).toThrow(`a server function outside functions.ts: ${path}.`);
  });
});
