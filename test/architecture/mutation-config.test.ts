import { describe, expect, it } from "vitest";

import strykerConfig from "../../stryker.conf.json";

/**
 * The two settings that make `--incremental` safe, pinned.
 *
 * CI passes `--incremental` to every mutation shard, which is what keeps
 * a re-push from re-measuring the whole scope. Reuse is only sound while
 * stryker knows which tests cover which mutant: `IncrementalDiffer`
 * reuses a stored verdict **unconditionally** when the runner reports no
 * per-test coverage, so under `coverageAnalysis: "off"` a Survived mutant
 * would stay survived for ever — even as someone adds the test that kills
 * it — and the shard would go green on a stored lie rather than on a
 * measurement.
 *
 * That is a worse failure than the slowness incremental exists to fix,
 * because it is silent and it points the wrong way. Neither value can be
 * left to a default: `perTest` is stryker's default *today*, and the
 * `command` runner does not support coverage at all, so switching runner
 * would turn the flag unsound with nothing in the diff to show for it.
 *
 * If you need to change either one, take `--incremental` out of
 * `.github/workflows/mutation.yml` in the same commit.
 */
describe("stryker.conf.json", () => {
  it("keeps per-test coverage, which is what makes incremental reuse sound", () => {
    expect(strykerConfig.coverageAnalysis).toBe("perTest");
  });

  it("keeps the vitest runner, which is the one that reports that coverage", () => {
    expect(strykerConfig.testRunner).toBe("vitest");
  });

  it("still breaks at 100 — the ratchet is the whole point", () => {
    expect(strykerConfig.thresholds.break).toBe(100);
  });
});
