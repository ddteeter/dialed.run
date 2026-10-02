import { describe, expect, it } from "vitest";

import strykerConfig from "../../stryker.conf.json";
import { ratchetGlob } from "./ratchet-glob";

function byPath(a: string, b: string): number {
  return a.localeCompare(b);
}

/**
 * Every `.ts` file under `src/lib`, subdirectories included.
 *
 * `import.meta.glob`, not `readdirSync`: these run in the workers pool,
 * which has no real filesystem — `readdir("src/lib")` resolves inside
 * workerd and fails. Vite resolves this at build time, so it sees the
 * directory as it is on disk. Same device `server-functions-are-glue`
 * uses to enumerate modules.
 */
function libFilesOnDisk(): string[] {
  return Object.keys(
    import.meta.glob("../../src/lib/**/*.ts", { query: "?raw" }),
  ).map((path) => path.replace("../../", ""));
}

/**
The `src/lib` entries, each as its list of positive paths and globs.
*/
function libEntries(): string[][] {
  return strykerConfig.mutate
    .filter((entry) => entry.startsWith("src/lib/"))
    .map((entry) => entry.split(",").filter((path) => !path.startsWith("!")));
}

/**
 * The settings CI's `--incremental` depends on, pinned.
 *
 * CI passes `--incremental` to every mutation shard, which is what keeps a
 * re-push from re-measuring the whole scope. Reuse is only sound while
 * stryker knows which tests cover which mutant: `IncrementalDiffer`'s
 * `mutantCanBeReused` returns `true` **unconditionally** when the runner
 * reports no coverage, so a `Survived` verdict would be reused however the
 * tests changed — the test that kills it could never clear it, and the
 * shard would go green on a stored lie rather than on a measurement.
 *
 * **The runner is what decides that, and `coverageAnalysis` is not.** That
 * is measured rather than read: against stryker 10, over a fixture with one
 * known survivor whose covering test is then strengthened, the vitest
 * runner populates `coveredBy` and overturns the cached survivor under
 * `perTest`, `all` **and** `off` alike — while the `command` runner writes
 * no `coveredBy` at all and reuses every stored verdict. Reading
 * `test-coverage.js` suggests otherwise (`hasCoverage` is derived from
 * `staticCoverage`, which `off` looks like it should suppress); the reading
 * is wrong, and it misled two people before the fixture settled it.
 * Credit to the agent on agentic-guardrails-scaffolding#60, whose drift
 * test produced the table.
 *
 * So: `testRunner` is the assertion that carries the soundness argument.
 * `coverageAnalysis` is pinned too, for a different reason — see below.
 *
 * If you change the runner, take `--incremental` out of
 * `.github/workflows/mutation.yml` in the same commit.
 */
describe("stryker.conf.json", () => {
  it("keeps the vitest runner, which is the one that reports per-test coverage", () => {
    // The load-bearing one. `command` is the runner that cannot report it,
    // and it is stryker's own schema default — so a config that names no
    // runner is a coverage-blind config.
    expect(strykerConfig.testRunner).toBe("vitest");
  });

  it("keeps per-test coverage, which is what stops every mutant re-running the suite", () => {
    // Runtime, not soundness. `perTest` is what lets stryker run only the
    // tests that cover a mutant — 2.6 to 7 per mutant across the ratcheted
    // scopes. Under `all` every mutant re-runs the whole suite, which is
    // what a *static* mutant already does and why `src/lib` (43% static)
    // takes 30 minutes while `modules/feed` (0%) takes 4.
    expect(strykerConfig.coverageAnalysis).toBe("perTest");
  });

  it("still breaks at 100 — the ratchet is the whole point", () => {
    expect(strykerConfig.thresholds.break).toBe(100);
  });

  it("does not turn --incremental on for everyone, because the gate must not have it", () => {
    /**
     * `mutation.yml` passes `--incremental` per shard, where it is sound:
     * a shard's `--mutate` is one fixed glob, so the stored report and the
     * run describe the same set. That workflow's own comment says it is
     * *"safe here in a way it is not on the commit gate"* — and the gate's
     * `--mutate` really is a different set of changed files every run.
     *
     * Setting it in this file turned it on for the gate and for every
     * local run too. The cost was measured rather than imagined: a mutant
     * came back `Survived` that a test demonstrably killed — applying it by
     * hand failed the test, and a run with the report deleted scored 100.
     *
     * So the flag belongs on the command line that can reason about its own
     * scope, and nowhere else. CI is unaffected: it passes it explicitly.
     */
    expect(strykerConfig).not.toHaveProperty("incremental");
  });

  it("matches every file in src/lib to exactly one entry, which split entries cannot promise on their own", () => {
    /**
     * `src/lib` is split across nine entries rather than one
     * `src/lib/**\/*.ts` glob, because it was the longest shard in every
     * run — 31.8 minutes cold, 4.3 warm, about 2.5x the next one either
     * way — and its static mutants each re-run the whole suite. The
     * directory is laid out by where code may run (`contracts/`, `sql/`,
     * `browser/`, isomorphic files at the root), and so are the entries:
     * `sql/` and `browser/` are one glob each, while `contracts/` is
     * four explicit lists — three balanced by static-mutant count, plus
     * `thermal.ts` on its own — and the root is three: `nav-types.ts`
     * alone, for its static-heavy module-level `NAV` table, and two lists
     * balanced by static weight. The `contracts.ts` barrel rides with a
     * contracts shard, which is why the root is listed rather than globbed.
     *
     * The split has to be by *positive* path. A `!src/lib/contracts.ts`
     * negation would read as "this file cannot be mutated" to the
     * commit-gate analyzer, which appends every negation in the array to
     * its own `--mutate` — exempting the file from the gate entirely.
     *
     * The cost is that a file added to the root or to `contracts/` joins
     * no shard unless someone remembers to list it, and nothing would
     * fail: the file would simply never be mutated, and the ratchet would
     * report 100% on a scope that no longer covers the directory. This is
     * the check that makes the split safe — and it checks *exactly one*
     * entry, because a file matched by two shards is mutated twice for
     * nothing.
     */
    // For each file, how many entries match it. A path named twice inside
    // one entry still counts once — stryker dedupes within a scope — but
    // two entries matching it is two shards mutating it. Sorted, because
    // the order entries appear in is a sharding decision and not a fact
    // about coverage.
    const onDisk = libFilesOnDisk().toSorted(byPath);
    const matches = Object.fromEntries(
      onDisk.map((file) => [
        file,
        libEntries().filter((paths) =>
          paths.some((path) => ratchetGlob(path).test(file)),
        ).length,
      ]),
    );
    expect(matches).toStrictEqual(
      Object.fromEntries(onDisk.map((file) => [file, 1])),
    );
  });

  it("names no src/lib path that matches nothing on disk", () => {
    // The other direction: an entry left pointing at a moved or deleted
    // file matches nothing, and a shard made only of such paths mutates
    // nothing and passes.
    const onDisk = libFilesOnDisk();
    const deadPaths = libEntries()
      .flat()
      .filter((path) => onDisk.every((file) => !ratchetGlob(path).test(file)));

    expect(deadPaths).toStrictEqual([]);
  });
});
