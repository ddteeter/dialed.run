import { describe, expect, it } from "vitest";

import {
  formatReport,
  measure,
  noWorse,
  type ReplayOutcome,
} from "../../../src/modules/call/replay";
import { outcome } from "./fixtures";

function logged(replayed: ReplayOutcome): ReplayOutcome {
  return {
    ...replayed,
    replayCase: { ...replayed.replayCase, origin: "logged" },
  };
}

function reportOver(
  outcomes: ReplayOutcome[],
  reads: ("tempC" | "feelsLikeC")[] = [],
) {
  const metrics = measure(outcomes);
  return formatReport(
    { engineVersion: "v1", metrics },
    { engineVersion: "v2", metrics },
    noWorse(metrics, metrics, { tolerance: 0, reads, observed: [] }),
  );
}

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
      noWorse(baseline, candidate, { tolerance: 0, reads: [], observed: [] }),
    );
    expect(report.source).toBe("v1-history");
    expect(report.text.split("\n")).toEqual([
      "source: v1 history (rebuilt)",
      "measure                             v1                            v2                            verdict",
      "cases                               3                             3",
      "coverage                            100.0% (3/3)                  66.7% (2/3)                   worse",
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
      "release check (tolerance 0): FAIL",
    ]);
  });

  it("says PASS or FAIL, and names the tolerance", () => {
    const better = measure([outcome(["a-tee"], 0, ["a-tee"])]);
    const worse = measure([outcome(["a-tee"], 0, ["m-long"])]);
    const report = formatReport(
      { engineVersion: "v1", metrics: better },
      { engineVersion: "v2", metrics: worse },
      noWorse(better, worse, { tolerance: 0.5, reads: [], observed: [] }),
    );
    expect(report.text.split("\n").at(-1)).toBe(
      "release check (tolerance 0.5): FAIL",
    );
    expect(report.text).toContain(
      "100.0% (1/1)                  0.0% (0/1)                    worse",
    );
    expect(
      reportOver([
        outcome(["a-tee"], 0, ["a-tee"]),
        outcome(["a-tee"], -1, ["m-long"]),
      ])
        .text.split("\n")
        .at(-1),
    ).toBe("release check (tolerance 0): PASS");
  });

  it("names the source it ran over", () => {
    const rebuilt = outcome(["a-tee"], 0, ["a-tee"]);
    const served = logged(outcome(["a-tee"], 0, ["a-tee"]));
    const firstLine = (outcomes: ReplayOutcome[]) =>
      reportOver(outcomes).text.split("\n", 1)[0];
    expect(reportOver([served]).source).toBe("logged-calls");
    expect(firstLine([served])).toBe("source: logged Calls");
    expect(reportOver([rebuilt, served]).source).toBe("mixed");
    expect(firstLine([rebuilt, served])).toBe(
      "source: mixed (rebuilt and logged)",
    );
  });

  it("says why a blocked check fails, above the verdict", () => {
    const lines = reportOver(
      [outcome(["a-tee"], 0, ["a-tee"])],
      ["tempC"],
    ).text.split("\n");
    expect(lines.slice(-2)).toEqual([
      "blocked: the candidate reads tempC, which cases rebuilt from v1 history do not carry; replay it over logged Calls",
      "release check (tolerance 0): FAIL",
    ]);
    expect(
      reportOver([outcome(["a-tee"], 0, ["a-tee"])], ["feelsLikeC"]).text,
    ).not.toContain("blocked");
  });
});
