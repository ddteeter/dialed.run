import { describe, expect, it } from "vitest";

import { codeOnly, isInstrumented, repoPath } from "./source-text";

/**
 * **Only `modules/weather` touches `dialed-weather`** (docs/architecture.md,
 * design 173).
 *
 * Feed's conditions and the account purge each read or deleted weather
 * tables themselves, and dependency-cruiser could not see it: importing
 * `db/schema-weather` and calling `weatherDb()` are both allowed imports
 * for any module. So this holds the rule as text. Other modules ask
 * weather's `index.ts`.
 *
 * `src/env` and the D1 session module are where the handle is made, and
 * the schema's own folder is where the tables are declared.
 */
const ALLOWED_PREFIXES = ["src/modules/weather/", "src/env/", "src/db/"];
const ALLOWED = new Set(["src/lib/sql/d1-session.ts"]);

const TOUCHES_WEATHER = /schema-weather["']|\bweatherDb\(/u;

const production: Record<string, string> = import.meta.glob(
  ["../../src/**/*.{ts,tsx}", "!../../src/db/migrations/**"],
  { query: "?raw", import: "default", eager: true },
);

function isAllowed(path: string): boolean {
  return (
    ALLOWED.has(path) ||
    ALLOWED_PREFIXES.some((prefix) => path.startsWith(prefix))
  );
}

describe("dialed-weather", () => {
  it("is touched by the weather module alone", () => {
    expect(Object.keys(production).map((path) => repoPath(path))).toContain(
      "src/modules/weather/read.ts",
    );
    const offenders = Object.entries(production)
      .filter(([path]) => !isAllowed(repoPath(path)))
      .filter(
        ([, source]) =>
          !isInstrumented(source) && TOUCHES_WEATHER.test(codeOnly(source)),
      )
      .map(([path]) => repoPath(path));
    expect(offenders).toEqual([]);
  });

  it("would catch a module reaching around the barrel", () => {
    expect(
      TOUCHES_WEATHER.test(
        'import { manualConditions } from "../../db/schema-weather";',
      ),
    ).toBe(true);
    expect(TOUCHES_WEATHER.test("const db = weatherDb();")).toBe(true);
    expect(
      TOUCHES_WEATHER.test('import { observationsAtCells } from "../weather";'),
    ).toBe(false);
  });

  it("allows only the module, the env and the schema", () => {
    expect(isAllowed("src/modules/weather/store.ts")).toBe(true);
    expect(isAllowed("src/env/d1.ts")).toBe(true);
    expect(isAllowed("src/lib/sql/d1-session.ts")).toBe(true);
    expect(isAllowed("src/modules/feed/conditions.ts")).toBe(false);
    expect(isAllowed("src/modules/account/purge.ts")).toBe(false);
  });
});
