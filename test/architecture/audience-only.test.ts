import { describe, expect, it } from "vitest";

import { isInstrumented, repoPath } from "./source-text";

/**
 * **The legacy sharing booleans are gone** (D-109, design 131, C2).
 *
 * An entry's audience replaced a boolean column, and so did a runner's
 * default audience. Migration `0046_drop_legacy_sharing_booleans` dropped
 * both columns and the two indexes that led on them, so a query naming
 * one now fails at runtime rather than at compile time: drizzle builds
 * whatever SQL it is given, and `sql` templates are only strings to `tsc`.
 *
 * So no production file may name them at all, as a drizzle property (the
 * original or the `legacy*` rename PR B gave them) or as a column, in code
 * or in a comment. Migration SQL and snapshots are history and are not
 * `.ts`, so they are outside this glob.
 */
const LEGACY_NAME =
  /\b(?:legacyIsPublic|legacyShareDefault|isPublic|is_public|shareDefault|share_default)\b/u;

const production: Record<string, string> = import.meta.glob(
  ["../../src/**/*.{ts,tsx}", "!../../src/db/migrations/**"],
  { query: "?raw", import: "default", eager: true },
);

describe("the legacy sharing booleans", () => {
  it("are named nowhere in src", () => {
    // The glob reached the schema, so an empty answer is not an empty scan.
    expect(Object.keys(production).map((path) => repoPath(path))).toContain(
      "src/db/schema-core.ts",
    );
    const offenders = Object.entries(production)
      .filter(
        ([, source]) => !isInstrumented(source) && LEGACY_NAME.test(source),
      )
      .map(([path]) => repoPath(path));
    expect(offenders).toEqual([]);
  });
});
