import { describe, expect, it } from "vitest";

import { isInstrumented, repoPath, withoutComments } from "./source-text";

/**
 * A glob key as a repo path. Vite writes a file under `test/` relative to
 * this one (`../feed/x.ts`), and anything else from the repo root
 * (`../../src/x.ts`).
 */
function pathOf(key: string): string {
  return key.startsWith("../../") ? repoPath(key) : key.replace("../", "test/");
}

/**
 * **Nothing reads the legacy sharing booleans** (D-109, design 131, PR B).
 *
 * An entry's audience replaced `outfit_entries.is_public`, and a runner's
 * default audience replaced `user_profiles.share_default`. The booleans
 * stay until design 131's C2 drops them, and writers keep them in step
 * until C1, because code a rollback could restore still reads them. That
 * leaves a column every query can still name and every one would get a
 * plausible answer from, and a read that slipped back to it would be
 * silently wrong the first time the two disagree — which, once C1 stops
 * the dual write, is every new private entry.
 *
 * So the drizzle properties were renamed `legacyIsPublic` and
 * `legacyShareDefault` (the column names did not change, so no migration),
 * and this pins where those names may appear:
 *
 * - in `src/`, the schema, the three dual writes and nothing else, each
 *   write counted so a fourth site cannot hide inside an allowed file;
 * - in tests and demo seeds, the shared seed helpers and the tests that
 *   assert the dual write or seed a disagreement on purpose. Each listed
 *   file must still use one, so the list cannot outlive its reasons.
 *
 * And no production code names the columns themselves in SQL, outside the
 * schema. C1 removes the dual writes from this list; C2 deletes the file.
 */

const LEGACY = /\blegacy(?:IsPublic|ShareDefault)\b/gu;

const production: Record<string, string> = import.meta.glob(
  ["../../src/**/*.{ts,tsx}", "!../../src/db/migrations/**"],
  { query: "?raw", import: "default", eager: true },
);

const suites: Record<string, string> = import.meta.glob(
  ["../../test/**/*.{ts,tsx}", "../../e2e/**/*.ts"],
  { query: "?raw", import: "default", eager: true },
);

/**
The production files that may name a legacy property, and how often.
*/
const PRODUCTION_SITES: Record<string, number | "schema"> = {
  // The two definitions, and the two indexes C2 drops with them.
  "src/db/schema-core.ts": "schema",
  // `attachKit`'s insert and `submitVerdict`'s update.
  "src/modules/feed/entries.ts": 2,
  // `preferenceColumns`, behind `savePreferences`: its return type and
  // the one write.
  "src/modules/onboarding/profile.ts": 2,
};

/**
The tests and seeds that may, each for a reason it states.
*/
const SUITE_SITES = new Set([
  // The seed helpers every entry and profile seed goes through.
  "e2e/support/audience.ts",
  "test/feed/helpers.ts",
  // The migrations' own SQL, run over rows with each boolean.
  "test/audience-backfill.test.ts",
  // The dual write, asserted on each writer.
  "test/account/unconfirmed-sharing.test.ts",
  "test/feed/backlog.test.ts",
  "test/feed/entries-edges.test.ts",
  "test/onboarding/profile.test.ts",
  // A moderator's hide leaves the runner's own choice alone.
  "test/safety/review.test.ts",
  // A boolean that disagrees with the audience, to prove which one a
  // read follows.
  "test/feed/share-default.test.ts",
  "test/safety/visibility.test.ts",
]);

/**
 * The properties before the rename. `tsc` does not catch every leftover:
 * an object built elsewhere and spread into `.values({ ...columns })`
 * escapes the excess-property check, so a helper still returning
 * `shareDefault` compiles and silently stops writing the boolean. That is
 * how `preferenceColumns` would have dropped the dual write, which is why
 * this is checked as text.
 */
const OLD_PROPERTY = /\b(?:isPublic|shareDefault)\b/u;

/**
 * The tests that post the previous bundle's boolean to prove the input
 * schema refuses it, and nothing else.
 */
const STALE_PAYLOADS = new Set([
  "test/feed/inputs.test.ts",
  "test/onboarding/profile.test.ts",
]);

/**
Each file's code (comments out) by its repo path, stryker's rewrites skipped.
*/
function code(files: Record<string, string>): Map<string, string> {
  const out = new Map<string, string>();
  for (const [path, source] of Object.entries(files)) {
    if (isInstrumented(source)) continue;
    out.set(pathOf(path), withoutComments(source));
  }
  return out;
}

function legacyCount(source: string): number {
  return source.match(LEGACY)?.length ?? 0;
}

describe("the legacy sharing booleans", () => {
  it("are named in src only by the schema and the three dual writes", () => {
    const found: Record<string, number> = {};
    for (const [path, source] of code(production)) {
      const count = legacyCount(source);
      if (count > 0) found[path] = count;
    }
    expect(Object.keys(found).toSorted((a, b) => a.localeCompare(b))).toEqual(
      Object.keys(PRODUCTION_SITES).toSorted((a, b) => a.localeCompare(b)),
    );
    for (const [path, expected] of Object.entries(PRODUCTION_SITES)) {
      if (expected !== "schema") expect(found[path], path).toBe(expected);
    }
  });

  it("are named in tests and seeds only by the files that say why", () => {
    const found = [...code(suites)]
      .filter(([, source]) => legacyCount(source) > 0)
      .map(([path]) => path)
      .toSorted((a, b) => a.localeCompare(b));
    expect(found).toEqual(
      [...SUITE_SITES].toSorted((a, b) => a.localeCompare(b)),
    );
  });

  it("are never named by their old properties or columns in production code", () => {
    const offenders = [...code(production)]
      .filter(
        ([path, source]) =>
          OLD_PROPERTY.test(source) ||
          (path !== "src/db/schema-core.ts" &&
            /\b(?:is_public|share_default)\b/u.test(source)),
      )
      .map(([path]) => path);
    expect(offenders).toEqual([]);
  });

  it("are named by their old properties in tests only as a stale tab's payload", () => {
    const found = [...code(suites)]
      .filter(([, source]) => OLD_PROPERTY.test(source))
      .map(([path]) => path)
      .toSorted((a, b) => a.localeCompare(b));
    expect(found).toEqual(
      [...STALE_PAYLOADS].toSorted((a, b) => a.localeCompare(b)),
    );
  });
});
