import { describe, expect, it } from "vitest";

import { codeOnly, isInstrumented, repoPath } from "./source-text";

/**
 * **Every query reaches D1 through `src/env/d1.ts`** (design 143, D-123).
 *
 * A request's reads may go to a read replica only through its D1 session,
 * and a write's checks must not: `coreDb()`, `weatherDb()` and
 * `primaryCoreDb()` are where that is decided. A handle built straight on
 * a binding, a raw `prepare` on one, or a session opened by hand goes
 * around the decision silently: it still works, it just reads the primary,
 * or a replica nobody chose. So nothing outside `src/env` names a D1
 * binding, and nothing outside the session module opens a session.
 *
 * The one exception is the health check, whose job is to prove each
 * primary answers: a replica answering would hide exactly the outage it
 * exists to report.
 */
const ALLOWED = new Set([
  "src/env/d1.ts",
  "src/lib/sql/d1-session.ts",
  "src/modules/ops/health.ts",
]);

const BYPASS = /\benv\.DIALED_(?:CORE|WEATHER)\b|\.withSession\(/u;

const production: Record<string, string> = import.meta.glob(
  ["../../src/**/*.{ts,tsx}", "!../../src/db/migrations/**"],
  { query: "?raw", import: "default", eager: true },
);

describe("D1 access", () => {
  it("goes through the accessors everywhere else", () => {
    expect(Object.keys(production).map((path) => repoPath(path))).toContain(
      "src/env/d1.ts",
    );
    const offenders = Object.entries(production)
      .filter(([path]) => !ALLOWED.has(repoPath(path)))
      .filter(
        ([, source]) =>
          !isInstrumented(source) && BYPASS.test(codeOnly(source)),
      )
      .map(([path]) => repoPath(path));
    expect(offenders).toEqual([]);
  });

  it("would catch a bypass", () => {
    expect(BYPASS.test("const db = drizzle(env.DIALED_CORE);")).toBe(true);
    expect(BYPASS.test("env.DIALED_WEATHER.prepare('select 1')")).toBe(true);
    expect(BYPASS.test("env.DIALED_CORE.withSession('first-primary')")).toBe(
      true,
    );
    expect(BYPASS.test("const db = coreDb();")).toBe(false);
  });
});
