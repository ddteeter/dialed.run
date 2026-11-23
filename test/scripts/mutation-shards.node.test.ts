/**
 * Which Mutation shards a PR runs (design 259): `scripts/mutation-shards/`.
 * The decisions run on a hand-built graph, so each case shows the rule it
 * is about; the last cases cruise this repository, as CI does. The `node`
 * project: dependency-cruiser and the TypeScript compiler cannot load in
 * workerd.
 */
import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { describe, expect, it } from "vitest";
import { z } from "zod";

import { hasModuleGlob, readGraph } from "../../scripts/mutation-shards/graph";
import {
  type Change,
  type Graph,
  isInScope,
  keptShards,
  parseNameStatus,
  selectShards,
  shardsOf,
} from "../../scripts/mutation-shards/select";
import strykerConfig from "../../stryker.conf.json";

const SHARDS = shardsOf([
  "src/lib/a.ts,src/lib/b.ts",
  "src/modules/x/**/*.ts,!src/modules/x/functions.ts",
  "src/modules/y/**/*.ts",
  "src/ui/**/*.tsx",
]);

/**
y's service imports x's door, which reaches lib/a; x's functions.ts is
negated. One test covers x through its door, one covers ui, and a route
wires x's server functions.
*/
const IMPORTS: Record<string, string[]> = {
  "src/lib/a.ts": [],
  "src/lib/b.ts": [],
  "src/modules/x/index.ts": ["src/modules/x/service.ts"],
  "src/modules/x/service.ts": ["src/lib/a.ts"],
  "src/modules/x/functions.ts": ["src/modules/x/service.ts"],
  "src/modules/y/service.ts": ["src/modules/x/index.ts"],
  "src/ui/Button.tsx": [],
  "src/routes/x.tsx": ["src/modules/x/functions.ts"],
  "src/lib/words.txt": [],
  "test/x/service.test.ts": ["src/modules/x/index.ts", "test/support.ts"],
  "test/ui/button.dom.test.tsx": ["src/ui/Button.tsx"],
  "test/support.ts": [],
};

function graphOf(unseen: readonly string[] = []): Graph {
  return { imports: new Map(Object.entries(IMPORTS)), unseen: new Set(unseen) };
}

function changed(...paths: string[]): Change[] {
  return paths.map((file) => ({ path: file, deleted: false }));
}

function keptNames(changes: readonly Change[], graph = graphOf()): string[] {
  return keptShards(SHARDS, selectShards(SHARDS, changes, graph)).map(
    (shard) => shard.name,
  );
}

function everyShardReason(changes: readonly Change[], graph = graphOf()) {
  const selection = selectShards(SHARDS, changes, graph);
  return selection.kind === "all" ? selection.reason : undefined;
}

describe("a PR's shards", () => {
  it("keep the changed file's shard and the shards of every file that imports it", () => {
    expect(keptNames(changed("src/modules/x/service.ts"))).toStrictEqual([
      "modules/x (ts)",
      "modules/y (ts)",
    ]);
    expect(keptNames(changed("src/lib/a.ts"))).toStrictEqual([
      "lib/a (ts)",
      "modules/x (ts)",
      "modules/y (ts)",
    ]);
  });

  it("say why each was kept", () => {
    const selection = selectShards(
      SHARDS,
      changed("src/modules/x/service.ts"),
      graphOf(),
    );
    expect(selection).toStrictEqual({
      kind: "some",
      kept: new Map([
        ["modules/x (ts)", "src/modules/x/service.ts changed"],
        [
          "modules/y (ts)",
          "src/modules/y/service.ts imports src/modules/x/service.ts",
        ],
      ]),
    });
  });

  it("keep, for a changed test, the shards of every file it reaches", () => {
    expect(keptNames(changed("test/x/service.test.ts"))).toStrictEqual([
      "lib/a (ts)",
      "modules/x (ts)",
    ]);
    expect(keptNames(changed("test/ui/button.dom.test.tsx"))).toStrictEqual([
      "ui (tsx)",
    ]);
  });

  it("keep none for a docs-only change, or a route nothing in a scope imports", () => {
    expect(
      keptNames(changed("docs/designs/259-x.md", "README.md", ".claude/a.md")),
    ).toStrictEqual([]);
    expect(keptNames(changed("src/routes/x.tsx"))).toStrictEqual([]);
    expect(keptNames(changed("e2e/transcripts/x.txt"))).toStrictEqual([]);
  });

  it("keep a deleted file's own shard, and only that", () => {
    expect(
      keptNames([{ path: "src/modules/x/service.ts", deleted: true }]),
    ).toStrictEqual(["modules/x (ts)"]);
  });

  it("keep the shards of a file whose imports the graph cannot see, whatever it may import", () => {
    expect(
      keptNames(changed("src/ui/Button.tsx"), graphOf(["src/lib/b.ts"])),
    ).toStrictEqual(["lib/a (ts)", "ui (tsx)"]);
  });
});

describe("every shard runs", () => {
  it("when the diff changes what every shard runs on", () => {
    for (const file of [
      "package.json",
      "package-lock.json",
      ".npmrc",
      "mise.toml",
      "stryker.conf.json",
      "vitest.config.ts",
      "vite.config.ts",
      "tsconfig.json",
      "wrangler.jsonc",
      "worker-configuration.d.ts",
      ".github/workflows/ci.yml",
      "public/mediapipe/x.wasm",
      "src/db/migrations/core/0001_x.sql",
      "scripts/mutation-shards.ts",
      "scripts/mutation-shards/select.ts",
    ]) {
      expect(everyShardReason(changed("docs/a.md", file))).toBe(
        `${file} is what every shard runs on`,
      );
    }
  });

  it("when a test's support changes: a helper, a setup file, a fixture", () => {
    for (const file of [
      "test/support.ts",
      "test/dom-setup.ts",
      "test/fixtures/sample-photo.bin",
    ]) {
      expect(everyShardReason(changed(file))).toBe(
        `${file} supports the tests, outside the import graph`,
      );
    }
  });

  it("when a changed file is one the graph did not find", () => {
    for (const file of [
      "src/modules/x/new.ts",
      "src/styles.css",
      "e2e/support/new.ts",
      "scripts/new.ts",
      "test/x/new.test.ts",
    ]) {
      expect(everyShardReason(changed(file))).toBe(
        `${file} is not in the import graph`,
      );
    }
    expect(everyShardReason(changed("src/lib/words.txt"))).toBeUndefined();
  });

  it("when a test is deleted, since what it reached is gone", () => {
    expect(
      everyShardReason([{ path: "test/x/service.test.ts", deleted: true }]),
    ).toBe("test/x/service.test.ts was deleted, so what it reached is unknown");
  });

  it("when a changed test reaches a file whose imports the graph cannot see", () => {
    expect(
      everyShardReason(
        changed("test/x/service.test.ts"),
        graphOf(["src/modules/x/service.ts"]),
      ),
    ).toBe(
      "test/x/service.test.ts reaches src/modules/x/service.ts, whose imports the graph cannot follow",
    );
  });

  it("in the order stryker.conf.json lists them", () => {
    expect(
      keptShards(SHARDS, { kind: "all", reason: "package.json" }),
    ).toStrictEqual(SHARDS);
  });
});

describe("a shard's scope", () => {
  it("is its positive paths, less its negations", () => {
    const [, x] = SHARDS;
    expect(x && isInScope(x, "src/modules/x/deep/file.ts")).toBe(true);
    expect(x && isInScope(x, "src/modules/x/functions.ts")).toBe(false);
    expect(x && isInScope(x, "src/modules/x/a.tsx")).toBe(false);
  });
});

describe("the shards' names and slugs", () => {
  it("are the job and artifact names Mutation has always used", () => {
    const shards = shardsOf(strykerConfig.mutate);
    expect(shards.map((shard) => shard.mutate)).toStrictEqual(
      strykerConfig.mutate,
    );
    const names = shards.map(({ name, slug }) => `${name} | ${slug}`);
    expect(names).toEqual(
      expect.arrayContaining([
        "lib/contracts/garments (ts) | lib-contracts-garments-ts",
        "lib/sql (ts) | lib-sql-ts",
        "ui (tsx) | ui-tsx",
        "modules/safety (tsx) | modules-safety-tsx",
        "modules/closet/tap-list-data (ts) | modules-closet-tap-list-data-ts",
        "e2e/audit/shot-plan (ts) | e2e-audit-shot-plan-ts",
      ]),
    );
  });
});

describe("git's name-status lines", () => {
  it("read as paths, a D as deleted", () => {
    expect(
      parseNameStatus("M\tsrc/a.ts\nD\ttest/b.test.ts\nA\tdocs/c.md\n\n"),
    ).toStrictEqual([
      { path: "src/a.ts", deleted: false },
      { path: "test/b.test.ts", deleted: true },
      { path: "docs/c.md", deleted: false },
    ]);
  });
});

describe("an import.meta.glob", () => {
  it("hides imports when it loads modules, not when it reads text", () => {
    expect(
      hasModuleGlob("a.ts", 'const m = import.meta.glob("../src/**/*.ts");'),
    ).toBe(true);
    expect(
      hasModuleGlob(
        "a.ts",
        'const m = import.meta.glob("../src/**/*.ts", { query: "?raw", eager: true });',
      ),
    ).toBe(false);
    expect(hasModuleGlob("a.ts", 'import x from "./x";')).toBe(false);
  });
});

const CRUISE_MS = 120_000;

describe("this repository's graph", () => {
  it(
    "resolves aliases, leaves packages out, and marks what it cannot see",
    async () => {
      const graph = await readGraph();
      expect(graph.imports.get("src/lib/contracts.ts")).toEqual(
        expect.arrayContaining(["src/lib/contracts/garments.ts"]),
      );
      const everyImport = [...graph.imports].flatMap(([, files]) => files);
      expect(
        everyImport.filter((file) => file.startsWith("node_modules/")),
      ).toStrictEqual([]);
      expect(
        graph.unseen.has("test/architecture/server-functions-are-glue.test.ts"),
      ).toBe(true);
      expect(graph.unseen.has("test/architecture/audience-only.test.ts")).toBe(
        false,
      );
    },
    CRUISE_MS,
  );

  it(
    "keeps, through the CLI, a module's shard and not a lib shard nothing there reaches",
    () => {
      const directory = mkdtempSync(path.join(tmpdir(), "mutation-shards-"));
      try {
        const changes = path.join(directory, "changes.txt");
        writeFileSync(changes, "M\tsrc/modules/weather/index.ts\n");
        const run = spawnSync(
          path.resolve("node_modules/.bin/tsx"),
          ["scripts/mutation-shards.ts", changes],
          { encoding: "utf8" },
        );
        expect(run.status).toBe(0);
        const names = z
          .array(z.object({ name: z.string() }))
          .parse(JSON.parse(run.stdout))
          .map((shard) => shard.name);
        expect(names).toContain("modules/weather (ts)");
        expect(names).not.toContain("lib/contracts/thermal (ts)");
        expect(run.stderr).toContain(
          "modules/weather (ts): src/modules/weather/index.ts changed",
        );
      } finally {
        rmSync(directory, { recursive: true, force: true });
      }
    },
    CRUISE_MS,
  );

  it("prints every shard when given no changes, as a push to main is", () => {
    const run = spawnSync(
      path.resolve("node_modules/.bin/tsx"),
      ["scripts/mutation-shards.ts"],
      { encoding: "utf8" },
    );
    expect(run.status).toBe(0);
    expect(JSON.parse(run.stdout)).toStrictEqual(
      shardsOf(strykerConfig.mutate),
    );
  });
});
