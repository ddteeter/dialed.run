import { describe, expect, it } from "vitest";

/**
 * What keeps server-only code out of the client bundle (D-50).
 *
 * **The mechanism is narrower than it looks, and knowing which one it is
 * decides what a fix has to do.** The Start plugin replaces a
 * `createServerFn` handler *body*, and rollup then shakes out everything
 * only that body used — verified against the shipped chunk, which contains
 * no `onConflictDoUpdate`, no `INSERT OR IGNORE`, and not even the
 * `PARSE_FAILURE_MESSAGE` string constant from `runs/parsers/shared.ts`.
 *
 * What it does *not* shake is a **module-scope call it cannot prove pure**.
 * Two of those were holding ~89 kB — a quarter of the client entry chunk —
 * for every visitor:
 *
 * - `const xmlParser = new XMLParser({…})` in `runs/parsers/shared.ts`,
 *   which kept `fast-xml-parser` and its four dependencies (~63 kB);
 * - the 23 `sqliteTable(…)` calls across `src/db/schema-*.ts`, which kept
 *   drizzle's column builders and the schema itself (~7 kB), and through
 *   `runs/inputs.ts` → `runs/imports.ts` the Garmin FIT SDK with them
 *   (~19 kB more once that edge was cut).
 *
 * **Nothing failed while that was true**, which is why it went unnoticed
 * for the whole build-out: `cloudflare:workers` is externalised rather than
 * bundled, so the symptom CLAUDE.md documents — a broken `npm run build` —
 * only ever fires for the binding import, never for the hundreds of
 * kilobytes behind it.
 *
 * These assertions pin the two fixes. They are a proxy, not the real
 * check: the honest one reads the built chunk and is `npm run
 * check:bundle`, which needs a CI job to be a gate and CI config is
 * human-managed. D-50 carries that.
 *
 * Raw text rather than `readFileSync`, because the workers pool sandboxes
 * the filesystem — same reason `server-functions-are-glue.test.ts` does it.
 */
const schemaSources: Record<string, string> = import.meta.glob(
  "../../src/db/schema-*.ts",
  { query: "?raw", import: "default", eager: true },
);

const parserSources: Record<string, string> = import.meta.glob(
  "../../src/modules/runs/parsers/*.ts",
  { query: "?raw", import: "default", eager: true },
);

const clientReachable: Record<string, string> = import.meta.glob(
  ["../../src/modules/runs/inputs.ts", "../../src/modules/runs/upload-limits.ts"],
  { query: "?raw", import: "default", eager: true },
);

function shortPath(key: string): string {
  return key.replace("../../", "");
}

describe("the client bundle carries no server-only code", () => {
  it("finds the schema files it is meant to be checking", () => {
    // The glob returning nothing would make every assertion below vacuous —
    // a suite that passes because it examined zero files is the failure
    // mode this whole file exists to prevent one layer up.
    expect(Object.keys(schemaSources).length).toBeGreaterThanOrEqual(3);
    expect(Object.keys(parserSources).length).toBeGreaterThanOrEqual(3);
  });

  it("marks every drizzle table constructor pure", () => {
    // `sqliteTable(…)` builds an object and touches nothing, but rollup
    // cannot know that, so an un-annotated call is a side effect it must
    // keep — and keeping one keeps the whole module, the whole schema, and
    // drizzle's column builders.
    for (const [key, source] of Object.entries(schemaSources)) {
      let declared = 0;
      for (const declaration of source.matchAll(
        /=\s*(\/\*#__PURE__\*\/\s*)?sqliteTable\(/g,
      )) {
        declared += 1;
        expect(
          declaration[1],
          `${shortPath(key)} has a sqliteTable() without /*#__PURE__*/ — it will ship to the browser`,
        ).toBeDefined();
      }
      expect(declared, `${shortPath(key)} declares no tables`).toBeGreaterThan(0);
    }
  });

  it("builds no parser at module scope", () => {
    // Constructed inside the function that parses instead. The
    // constructor only stores options, and the caller is a queue consumer
    // handling one file per message, so per-call costs nothing — and it is
    // the whole 63 kB.
    for (const [key, source] of Object.entries(parserSources)) {
      const withoutComments = source.replaceAll(/\/\*[\s\S]*?\*\//g, "");
      expect(
        withoutComments,
        `${shortPath(key)} constructs at module scope`,
      ).not.toMatch(/^(?:const|let|var)\s+\w+\s*[:=][^;]*\bnew\s+XMLParser\b/m);
    }
  });

  it("keeps the upload limits off the path that reaches the schema", () => {
    // `runs/inputs.ts` is genuinely client-side — the forms contract runs
    // one schema on both sides — so anything it imports is too. It used to
    // take `MAX_IMPORT_BYTES` and `ImportUploadError` from `./imports`,
    // which reaches `db/schema-core` and the FIT/GPX/TCX parsers: one
    // constant and one empty error class, holding the Garmin SDK in the
    // browser.
    const inputs = clientReachable["../../src/modules/runs/inputs.ts"];
    expect(inputs).toBeDefined();
    expect(inputs).not.toMatch(/from\s+"\.\/imports"/);
    expect(inputs).toMatch(/from\s+"\.\/upload-limits"/);
  });
});
