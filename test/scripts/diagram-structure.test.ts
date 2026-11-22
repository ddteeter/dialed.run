import { describe, expect, it } from "vitest";

import { generateStructure, mainOf } from "../../scripts/diagrams/structure";
import type {
  SourceFacts,
  StructureInputs,
} from "../../scripts/diagrams/structure";

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

const MAIN_FACTS: SourceFacts = {
  paths: ["src/server.ts"],
  imports: [],
  unread: [],
  serverFunctionFiles: [],
  mainEntries: ["fetch", "queue", "scheduled"],
};

function inputs(
  overrides: Partial<Omit<StructureInputs, "sources">> = {},
  sources: Partial<SourceFacts> = {},
): StructureInputs {
  return {
    wranglerJsonc: WRANGLER,
    crons: [],
    words: {},
    ...overrides,
    sources: {
      ...MAIN_FACTS,
      ...sources,
      paths: [...MAIN_FACTS.paths, ...(sources.paths ?? [])],
    },
  };
}

function lines(
  overrides: Partial<Omit<StructureInputs, "sources">> = {},
  sources: Partial<SourceFacts> = {},
): string[] {
  return generateStructure(inputs(overrides, sources))
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

const MODULES: Partial<SourceFacts> = {
  paths: [
    "src/modules/runs/index.ts",
    "src/modules/runs/imports.ts",
    "src/modules/runs/functions.ts",
    "src/modules/runs/upload-limits.ts",
    "src/modules/runs/parsers/index.ts",
    "src/modules/runs/parsers/fit.ts",
    "src/modules/runs/components/Upload.tsx",
    "src/modules/auth/index.ts",
    "src/modules/weather/index.ts",
    "src/modules/weather/attach.ts",
    "src/modules/weather/provider/index.ts",
    "src/modules/notifications/index.ts",
    "src/modules/public-pages/index.ts",
    "src/lib/now.ts",
    "src/db/schema-core.ts",
  ],
  imports: [
    // The wiring's import first: the service code's still makes the pair
    // `imports`, whichever comes first.
    {
      from: "src/modules/runs/functions.ts",
      to: "src/modules/weather/index.ts",
    },
    { from: "src/modules/runs/imports.ts", to: "src/modules/weather/index.ts" },
    {
      from: "src/modules/runs/imports.ts",
      to: "src/modules/runs/parsers/index.ts",
    },
    { from: "src/modules/runs/imports.ts", to: "src/db/schema-core.ts" },
    { from: "src/modules/runs/functions.ts", to: "src/modules/auth/index.ts" },
    {
      from: "src/modules/runs/parsers/fit.ts",
      to: "src/modules/runs/upload-limits.ts",
    },
    {
      from: "src/modules/runs/parsers/fit.ts",
      to: "src/modules/weather/provider/index.ts",
    },
    {
      from: "src/modules/runs/components/Upload.tsx",
      to: "src/modules/notifications/index.ts",
    },
    {
      from: "src/modules/weather/attach.ts",
      to: "src/modules/weather/provider/index.ts",
    },
    {
      from: "src/modules/notifications/index.ts",
      to: "src/modules/runs/index.ts",
    },
    { from: "src/lib/now.ts", to: "src/modules/runs/index.ts" },
  ],
};

describe("generateStructure: modules and their imports", () => {
  const out = lines({}, MODULES);

  it("draws a folder with its own index.ts as a module, nested where it sits", () => {
    const text = generateStructure(inputs({}, MODULES));

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

  it("draws nothing between a unit and its sub-module, nor to or from outside the modules", () => {
    const arrows = out.filter((line) =>
      /-\[(?:imports|wiring)\]->/u.test(line),
    );

    expect(arrows).toHaveLength(5);
  });

  it("writes no views: overview.c4's modules view is the one map", () => {
    const text = generateStructure(inputs({}, MODULES));

    expect(text).not.toContain("views {");
    expect(text.endsWith("\n}\n")).toBe(true);
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
    const out = lines(
      { words: { "cf.app.runs.parsers": "Reads a run file" } },
      MODULES,
    );

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

const UNLISTED = "has what the diagram neither draws nor lists";

describe("generateStructure: the ways in are closed lists", () => {
  it.each(["kv_namespaces", "durable_objects", "env"])(
    "throws on a wrangler.jsonc key it neither draws nor lists: %s",
    (key) => {
      const wranglerJsonc = `{ "${key}": {},${WRANGLER.slice(1)}`;

      expect(() => generateStructure(inputs({ wranglerJsonc }))).toThrow(
        `wrangler.jsonc ${UNLISTED}: ${key}.`,
      );
    },
  );

  it.each([["email"], ["tail"], ["export class Room"]])(
    "throws on an entry of main it does not list: %s",
    (entry) => {
      expect(() =>
        generateStructure(
          inputs({}, { mainEntries: ["fetch", "queue", entry] }),
        ),
      ).toThrow(`src/server.ts ${UNLISTED}: ${entry}.`);
    },
  );

  it("throws when main is not among the sources", () => {
    const wranglerJsonc = WRANGLER.replace("src/server.ts", "src/worker.ts");

    expect(() => generateStructure(inputs({ wranglerJsonc }))).toThrow(
      "wrangler.jsonc's main, src/worker.ts, is not a source read",
    );
  });

  it("throws on code in a folder beside src/modules it does not list", () => {
    expect(() =>
      generateStructure(
        inputs({}, { paths: ["src/lib/now.ts", "src/jobs/sweep.ts"] }),
      ),
    ).toThrow(`src ${UNLISTED}: jobs.`);
  });

  it("reads main from the config", () => {
    expect(mainOf(WRANGLER)).toBe("src/server.ts");
  });
});

describe("generateStructure: everything is read", () => {
  it.each([["src/modules/loose.ts"], ["src/modules/new-thing/service.ts"]])(
    "throws on a file in no module: %s",
    (path) => {
      expect(() =>
        generateStructure(
          inputs({}, { ...MODULES, paths: [...(MODULES.paths ?? []), path] }),
        ),
      ).toThrow(`${path} is in no module`);
    },
  );

  it("throws on a server function outside functions.ts in a module", () => {
    expect(() =>
      generateStructure(
        inputs(
          {},
          {
            ...MODULES,
            serverFunctionFiles: ["src/modules/runs/imports.ts"],
          },
        ),
      ),
    ).toThrow(
      "src/modules/runs/imports.ts creates a server function outside functions.ts",
    );
  });

  it("accepts a server function in functions.ts, a component, or outside the modules", () => {
    expect(() =>
      generateStructure(
        inputs(
          {},
          {
            ...MODULES,
            serverFunctionFiles: [
              "src/modules/runs/functions.ts",
              "src/modules/runs/components/Upload.tsx",
              "src/lib/now.ts",
            ],
          },
        ),
      ),
    ).not.toThrow();
  });

  it("throws on every import it could not follow, naming each", () => {
    const unread = [
      { from: "src/modules/feed/index.ts", text: "@/modules/gone" },
      { from: "src/lib/x.ts", text: "import(`../${name}`)" },
    ];

    expect(() => generateStructure(inputs({}, { unread }))).toThrow(
      "src/modules/feed/index.ts has an import the diagram cannot follow: @/modules/gone\n" +
        "src/lib/x.ts has an import the diagram cannot follow: import(`../${name}`)",
    );
  });
});
