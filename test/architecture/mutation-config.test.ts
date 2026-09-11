import { describe, expect, it } from "vitest";

import strykerConfig from "../../stryker.conf.json";

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

  it("covers every file in src/lib, which three positive entries cannot do on their own", () => {
    /**
     * `src/lib` is split across three entries rather than one
     * `src/lib/**\/*.ts` glob, because it was the longest shard in every
     * run — 31.8 minutes cold, 4.3 warm, about 2.5x the next one either
     * way — and `contracts.ts` plus `thermal.ts` are 248 of its 367
     * mutants.
     *
     * The split has to be by *positive* path. A `!src/lib/contracts.ts`
     * negation would read as "this file cannot be mutated" to the
     * commit-gate analyzer, which appends every negation in the array to
     * its own `--mutate` — exempting the file from the gate entirely.
     *
     * The cost is that adding a file to `src/lib` joins no shard unless
     * someone remembers to list it, and nothing would fail: the file would
     * simply never be mutated, and the ratchet would report 100% on a
     * scope that no longer covers the directory. This is the check that
     * makes the split safe.
     */
    // `import.meta.glob`, not `readdirSync`: these run in the workers
    // pool, which has no real filesystem — `readdir("src/lib")` resolves
    // inside workerd and fails. Vite resolves this at build time, so it
    // sees the directory as it is on disk. Same device
    // `server-functions-are-glue` uses to enumerate modules.
    const onDisk = Object.keys(
      import.meta.glob("../../src/lib/*.ts", { query: "?raw" }),
    ).map((path) => path.replace("../../", ""));

    const inScopes = strykerConfig.mutate
      .filter((entry) => entry.startsWith("src/lib/"))
      .flatMap((entry) => entry.split(","))
      .filter((path) => !path.startsWith("!"));

    // Sets, because the order entries appear in is a sharding decision and
    // not a fact about coverage — and `toSorted` is not in this project's
    // lib.
    expect(new Set(inScopes)).toStrictEqual(new Set(onDisk));
  });
});
