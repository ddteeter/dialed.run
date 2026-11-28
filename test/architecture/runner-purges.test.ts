import { describe, expect, it } from "vitest";

import { codeOnly, declarationsIn, repoPath } from "./source-text";

/**
 * Every runner's write purges their public pages with the purge counted
 * against them (`purgePublicPagesFor`, `ops/public-web/edge-purge.ts`), so
 * one runner's writes cannot spend the account's whole purge allowance.
 * The uncounted `purgePublicPages` is for the Desk and the crons.
 *
 * Two halves hold it:
 *
 * - **The compiler.** A callee that purges for a runner's write takes the
 *   purge as a required parameter, with no default: feed's deletes
 *   (`entries/retract.ts`), `submitVerdict` and `claimUsername`. A server
 *   function cannot reach one without naming a purge.
 * - **This test**, on what is named. A server function outside the Desk
 *   (`requireAdmin`) never names the uncounted purge. Anywhere else in the
 *   modules, only the declarations in `UNCOUNTED` name it, each for a
 *   reason, and no server function outside the Desk reaches one of them,
 *   directly or through whatever calls it.
 *
 * Read as text, as `verification-class` does: a `functions.ts` cannot be
 * imported by a test.
 */
const moduleSources: Record<string, string> = import.meta.glob(
  "../../src/modules/**/*.{ts,tsx}",
  { query: "?raw", import: "default", eager: true },
);

/**
The purges are defined here, and named here by design.
*/
const PURGES_HOME = "src/modules/ops/public-web/";

/**
 * Every declaration outside `ops/public-web` that names the uncounted
 * purge, and why that is right. A declaration that names it and has no
 * row fails, and so does a row whose declaration no longer names it.
 */
const UNCOUNTED: Readonly<Record<string, string>> = {
  "account/handles/username.ts forceRename":
    "its default: the Desk's rename of a runner's handle",
  "account/purge/purge.ts purgeAccount":
    "account deletion's purge, a cron: every page of the account goes, whatever the runner's share",
  "account/purge/purge.ts didDeleteEveryRun":
    "account deletion's purge, a cron, a page of runs at a time",
  "dispatch/scheduled.ts reconcileReportHides":
    "a cron that finishes the hide a report owed",
  "feed/moderation/moderation.ts moderateContent":
    "its default: the Desk's Remove, takedown and quarantine",
};

const NAMES_UNCOUNTED = /\bpurgePublicPages\b/u;
const DESK_GATE = /\brequireAdmin\(/u;

const declarations = declarationsIn(
  Object.fromEntries(
    Object.entries(moduleSources).filter(
      ([path]) => !repoPath(path).startsWith(PURGES_HOME),
    ),
  ),
).map(({ name, body }) => ({ name, code: codeOnly(body) }));

/**
A server function's handler is what `createServerFn(` builds.
*/
function isServerFunction(code: string): boolean {
  return code.includes("createServerFn(");
}

const runnerServerFunctions = declarations.filter(
  ({ code }) => isServerFunction(code) && !DESK_GATE.test(code),
);

function byName(left: string, right: string): number {
  return left.localeCompare(right);
}

/**
The bare name a declaration is declared under: `forceRename`.
*/
function shortName(name: string): string {
  return name.slice(name.lastIndexOf(" ") + 1);
}

/**
Whether `code` names any of `names` as a whole word.
*/
function doesNameAny(code: string, names: ReadonlySet<string>): boolean {
  return [...names].some((name) =>
    new RegExp(String.raw`\b${name}\b`, "u").test(code),
  );
}

/**
 * The bare names of the `UNCOUNTED` declarations and of every declaration
 * that names one, followed until nothing new is reached. A shared name
 * reaches further than it should, never less far.
 */
function reachingUncounted(): Set<string> {
  const reached = new Set(
    Object.keys(UNCOUNTED).map((name) => shortName(name)),
  );
  let isGrowing = true;
  while (isGrowing) {
    const added = declarations.filter(
      ({ name, code }) =>
        !reached.has(shortName(name)) &&
        !isServerFunction(code) &&
        doesNameAny(code, reached),
    );
    for (const { name } of added) reached.add(shortName(name));
    isGrowing = added.length > 0;
  }
  return reached;
}

describe("every runner write's purge is the counted one", () => {
  it("finds the server functions it checks", () => {
    // A scan that found nothing would pass everything below.
    expect(runnerServerFunctions.map(({ name }) => name)).toEqual(
      expect.arrayContaining([
        "runs/functions.ts deleteRunFn",
        "account/functions.ts claimUsernameFn",
        "feed/functions.ts retractEntryAction",
      ]),
    );
  });

  it("no server function outside the Desk names the uncounted purge", () => {
    expect(
      runnerServerFunctions
        .filter(({ code }) => NAMES_UNCOUNTED.test(code))
        .map(({ name }) => name),
    ).toStrictEqual([]);
  });

  it("the uncounted purge is named only where a row here says why", () => {
    expect(
      declarations
        .filter(
          ({ code }) =>
            NAMES_UNCOUNTED.test(code) &&
            !(isServerFunction(code) && DESK_GATE.test(code)),
        )
        .map(({ name }) => name)
        .toSorted(byName),
    ).toStrictEqual(Object.keys(UNCOUNTED).toSorted(byName));
  });

  it("no server function outside the Desk reaches a declaration that purges uncounted", () => {
    const reached = reachingUncounted();
    expect(
      runnerServerFunctions
        .filter(({ code }) => doesNameAny(code, reached))
        .map(({ name }) => name),
    ).toStrictEqual([]);
  });
});
