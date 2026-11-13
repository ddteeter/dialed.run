import { describe, expect, it } from "vitest";

import { isInstrumented, repoPath } from "./source-text";

/**
 * **The smoke account is invisible to runners by construction** (design
 * 193, #533; owner, 2026-11-09).
 *
 * Two floors hide it: `runnerInStanding` (search, H, the open web) and
 * the entry rules' author clause in `safety/visibility.ts`
 * (`publiclyVisibleEntry`, `worldVisibleEntry`, `entryVisibleTo`). A third
 * gate, `confirmedUserId`, refuses its writes that other runners see.
 * This file keeps a new surface from going round them:
 *
 * 1. **The mark is read only by the gates and written by nothing.** No app
 *    code may set it; the owner sets it with one `wrangler d1 execute`
 *    (docs/deployment.md §9).
 * 2. **Default-deny over the tables that can show one runner to another**
 *    (`userProfiles`, `outfitEntries`, `follows`, `reactions`): every
 *    production file that imports one has a row below saying why it can't
 *    show the account. A new file fails until someone decides, and a
 *    `floor` row must actually call a floor.
 */

const production: Record<string, string> = import.meta.glob(
  ["../../src/**/*.{ts,tsx}", "!../../src/db/migrations/**"],
  { query: "?raw", import: "default", eager: true },
);

function sources(): [string, string][] {
  return Object.entries(production)
    .filter(([, source]) => !isInstrumented(source))
    .map(([path, source]) => [repoPath(path), source]);
}

/**
 * Why a file that reads runner tables can't show the smoke account:
 *
 * - `floor`: it reads through one of the floors (checked below).
 * - `own`: it reads or writes only the signed-in runner's own rows.
 * - `actor`: it names another runner only as the one who did something
 *   `verifiedUserId` gated (a follow, a Useful), which a system account is
 *   refused.
 * - `operator`: only an operator sees what it reads (the Desk, the digest).
 * - `machinery`: it shows nobody anything: a writer, a purge, an upkeep
 *   cron, or a query skeleton whose callers add the floor.
 */
type Reason = "floor" | "own" | "actor" | "operator" | "machinery";

const READERS: Readonly<Record<string, Reason>> = {
  "src/modules/account/accounts.ts": "operator",
  "src/modules/account/export.ts": "own",
  "src/modules/account/handle-rescreen.ts": "machinery",
  "src/modules/account/handle-review.ts": "operator",
  "src/modules/account/invites.ts": "operator",
  "src/modules/account/purge.ts": "machinery",
  "src/modules/account/theme.ts": "own",
  "src/modules/account/username.ts": "own",
  "src/modules/auth/d1-bookmark.ts": "own",
  "src/modules/auth/system-account.ts": "own",
  "src/modules/closet/service.ts": "own",
  "src/modules/feed/backlog.ts": "own",
  "src/modules/feed/band-runs.ts": "own",
  "src/modules/feed/band-signals.ts": "own",
  "src/modules/feed/consensus.ts": "floor",
  "src/modules/feed/entries-query.ts": "machinery",
  "src/modules/feed/entries.ts": "floor",
  "src/modules/feed/feed.ts": "floor",
  "src/modules/feed/follow-notices.ts": "actor",
  "src/modules/feed/follows.ts": "actor",
  "src/modules/feed/garment-bands.ts": "own",
  "src/modules/feed/home.ts": "own",
  "src/modules/feed/moderation.ts": "operator",
  "src/modules/feed/own-history.ts": "own",
  "src/modules/feed/photos.ts": "floor",
  "src/modules/feed/profiles.ts": "floor",
  "src/modules/feed/public-kit.ts": "floor",
  "src/modules/feed/public-profile.ts": "floor",
  "src/modules/feed/reactions.ts": "floor",
  "src/modules/feed/retract.ts": "own",
  "src/modules/feed/run-conditions-entry.ts": "machinery",
  "src/modules/feed/runner-visibility.ts": "floor",
  "src/modules/feed/search.ts": "floor",
  "src/modules/feed/share-default.ts": "own",
  "src/modules/feed/units.ts": "own",
  "src/modules/notifications/service.ts": "actor",
  "src/modules/notifications/viewer-zone.ts": "own",
  "src/modules/onboarding/aggregate-prefs.ts": "own",
  "src/modules/onboarding/privacy-review.ts": "own",
  "src/modules/onboarding/profile.ts": "own",
  "src/modules/onboarding/public-profile.ts": "own",
  "src/modules/onboarding/starter-list.ts": "own",
  "src/modules/onboarding/time-zone.ts": "machinery",
  "src/modules/ops/desk.ts": "operator",
  "src/modules/ops/gave-up.ts": "operator",
  "src/modules/ops/owner-handles.ts": "operator",
  "src/modules/ops/public-photos.ts": "floor",
  "src/modules/products/correction-queue.ts": "operator",
  "src/modules/runs/awaiting-verdict.ts": "own",
  "src/modules/runs/service.ts": "own",
  "src/modules/safety/bans.ts": "operator",
  // The blocker's own list, of runners they found to block.
  "src/modules/safety/blocks.ts": "own",
  "src/modules/safety/copyright-holds.ts": "operator",
  "src/modules/safety/desk-kit.ts": "operator",
  "src/modules/safety/kit-cache-tags.ts": "machinery",
  // A notice tells a runner about their own kit, or a reporter about
  // their own report.
  "src/modules/safety/notices.ts": "own",
  "src/modules/safety/other-photos.ts": "operator",
  "src/modules/safety/photo-matches.ts": "operator",
  "src/modules/safety/quarantine.ts": "operator",
  "src/modules/safety/removed-fingerprints.ts": "operator",
  "src/modules/safety/reports.ts": "machinery",
  "src/modules/safety/review-audit.ts": "operator",
  "src/modules/safety/review.ts": "operator",
  "src/modules/safety/runners.ts": "operator",
  "src/modules/safety/takedown-requests.ts": "operator",
  "src/modules/safety/visibility.ts": "floor",
};

const RUNNER_TABLES = new Set([
  "userProfiles",
  "outfitEntries",
  "follows",
  "reactions",
]);

const SCHEMA_IMPORT =
  /import\s*(?:type\s*)?\{([^}]*)\}\s*from\s*"[./]*\/db\/schema-core"/gu;

/**
The runner tables a file imports from the core schema.
*/
function runnerTablesIn(source: string): string[] {
  const tables: string[] = [];
  for (const match of source.matchAll(SCHEMA_IMPORT)) {
    const names = (match[1] ?? "").split(",");
    for (const name of names) {
      const imported = name.trim().split(/\s/u, 1)[0] ?? "";
      if (RUNNER_TABLES.has(imported)) tables.push(imported);
    }
  }
  return tables;
}

const FLOOR_CALL =
  /\b(?:runnerInStanding|runnerVisibleToViewer|runnersVisibleTo|publiclyVisibleEntry|worldVisibleEntry|entryVisibleTo)\(/u;

const MARK = /\b(?:systemAccount|system_account)\b/gu;

const COLUMN_READ = /\buserProfiles\.systemAccount\b/gu;

function countOf(pattern: RegExp, source: string): number {
  // Neither pattern captures, so the pieces between matches are one more
  // than the matches.
  return source.split(pattern).length - 1;
}

/**
Where the mark may be named: its column, the two floors and the write gate.
*/
const MARK_READERS = [
  "src/db/schema-core.ts",
  "src/modules/auth/system-account.ts",
  "src/modules/feed/runner-visibility.ts",
  "src/modules/safety/visibility.ts",
];

describe("the system-account mark", () => {
  it("is named only by its column, the two floors and the write gate", () => {
    const naming = sources()
      .filter(([, source]) => countOf(MARK, source) > 0)
      .map(([path]) => path)
      .toSorted((a, b) => a.localeCompare(b));
    expect(naming).toStrictEqual(MARK_READERS);
  });

  it("is read there as a column and never set", () => {
    // `systemAccount:` is how drizzle names a column in `.set({…})` and
    // `.values({…})`, so outside the schema every mention must be a read
    // of the column.
    const gates = sources().filter(
      ([path]) => MARK_READERS.includes(path) && path !== MARK_READERS[0],
    );
    expect(gates).toHaveLength(MARK_READERS.length - 1);
    for (const [path, source] of gates) {
      expect({ path, reads: countOf(COLUMN_READ, source) }).toStrictEqual({
        path,
        reads: countOf(MARK, source),
      });
    }
  });
});

describe("every reader of a runner table", () => {
  const readers = sources().filter(
    ([path, source]) =>
      !path.startsWith("src/db/") && runnerTablesIn(source).length > 0,
  );

  it("finds the readers it classifies", () => {
    // An empty scan would pass everything below.
    expect(readers.map(([path]) => path)).toContain(
      "src/modules/feed/search.ts",
    );
  });

  it("says why it can't show a system account", () => {
    const unclassified = readers
      .map(([path]) => path)
      .filter((path) => READERS[path] === undefined);
    expect(unclassified).toStrictEqual([]);
  });

  it("has no row for a file that no longer reads one", () => {
    const reading = new Set(readers.map(([path]) => path));
    const stale = Object.keys(READERS).filter((path) => !reading.has(path));
    expect(stale).toStrictEqual([]);
  });

  it("reads through a floor wherever its row says it does", () => {
    const skipping = readers
      .filter(
        ([path, source]) =>
          READERS[path] === "floor" && !FLOOR_CALL.test(source),
      )
      .map(([path]) => path);
    expect(skipping).toStrictEqual([]);
  });
});
