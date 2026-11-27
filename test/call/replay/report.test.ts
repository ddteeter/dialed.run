import { describe, expect, it } from "vitest";

import {
  formatReport,
  measure,
  noWorse,
} from "../../../src/modules/call/replay";
import { outcome } from "./fixtures";

describe("formatReport", () => {
  it("sets two versions side by side with the release verdict", () => {
    const baseline = measure([
      outcome(["a-tee", "shorts"], 0, ["a-tee", "tights"], "probable"),
      outcome(["a-tee"], -1, ["a-tee"], "confident"),
      outcome(["shoes"], 1, ["spikes"], "confident"),
    ]);
    const candidate = measure([
      outcome(["a-tee", "shorts"], 0, ["a-tee", "shorts"], "best-guess"),
      outcome(["a-tee"], -1, ["m-long"], "confident"),
      outcome(["shoes"], 1, [], "below-threshold"),
    ]);
    const report = formatReport(
      { engineVersion: "v1", metrics: baseline },
      { engineVersion: "v2", metrics: candidate },
      noWorse(baseline, candidate, 0),
    );
    expect(report.split("\n")).toEqual([
      "measure                             v1                            v2                            verdict",
      "cases                               3                             3",
      "coverage                            100.0% (3/3)                  66.7% (2/3)",
      "dialed agreement                    50.0% (1/2)                   100.0% (2/2)                  better",
      "direction on misses                 0.0% (0/1) +1 no call         100.0% (1/1) +1 no call       better",
      "below-threshold · dialed agreement  — (0/0)                       — (0/0)",
      "below-threshold · direction         — (0/0) +0 no call            — (0/0) +1 no call",
      "best-guess · dialed agreement       — (0/0)                       100.0% (2/2)",
      "best-guess · direction              — (0/0) +0 no call            — (0/0) +0 no call",
      "probable · dialed agreement         50.0% (1/2)                   — (0/0)",
      "probable · direction                — (0/0) +0 no call            — (0/0) +0 no call",
      "confident · dialed agreement        — (0/0)                       — (0/0)",
      "confident · direction               0.0% (0/1) +1 no call         100.0% (1/1) +0 no call",
      "release check (tolerance 0): PASS",
    ]);
  });

  it("says FAIL, and names the tolerance, when the check fails", () => {
    const better = measure([outcome(["a-tee"], 0, ["a-tee"])]);
    const worse = measure([outcome(["a-tee"], 0, ["m-long"])]);
    const report = formatReport(
      { engineVersion: "v1", metrics: better },
      { engineVersion: "v2", metrics: worse },
      noWorse(better, worse, 0.5),
    );
    expect(report.split("\n").at(-1)).toBe(
      "release check (tolerance 0.5): FAIL",
    );
    expect(report).toContain(
      "100.0% (1/1)                  0.0% (0/1)                    worse",
    );
  });
});
