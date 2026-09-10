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
});
