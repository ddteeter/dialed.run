/**
 * The scorer and the replay harness, wired: the real `score` over the
 * seeded personas, through the release check it will be released by.
 */
import { describe, expect, it } from "vitest";

import type { Scorer } from "../../../src/modules/call/contract";
import {
  casesFrom,
  observedReads,
  releaseCheck,
  RELEASE_METRICS,
  syntheticPersonas,
  type ReplayCase,
} from "../../../src/modules/call/replay";
import {
  ENGINE_VERSION,
  SCORER_READS,
  score,
} from "../../../src/modules/call/scorer";

function seededCases(): ReplayCase[] {
  return syntheticPersonas(1).flatMap((persona) =>
    casesFrom(persona.history, persona.cohort),
  );
}

/**
 * The scorer, but taking its feel from the air temperature. On a rebuilt
 * case the two are the same number, so it answers exactly as `score` does
 * and only the probe can tell them apart.
 */
const feelFromTemp: Scorer = (request) => {
  const { conditions } = request;
  if (conditions.kind !== "forecast") return score(request);
  return score({
    ...request,
    conditions: { ...conditions, feelsLikeC: conditions.tempC },
  });
};

describe("the scorer under the replay harness", () => {
  it("is seen reading exactly the fields it declares", () => {
    expect(observedReads(score, seededCases())).toStrictEqual([
      ...SCORER_READS,
    ]);
  });

  it("passes its own release check over the seeded personas, on every measure", () => {
    const candidate = { scorer: score, reads: SCORER_READS };
    const { comparison, report } = releaseCheck(
      score,
      candidate,
      seededCases(),
      0,
    );

    expect(comparison.blocked).toBeUndefined();
    expect(comparison.source).toBe("v1-history");
    expect(
      RELEASE_METRICS.map((metric) => comparison.metrics[metric].verdict),
    ).toStrictEqual(["equal", "equal", "equal"]);
    expect(comparison.pass).toBe(true);
    const lines = report.text.split("\n");
    expect(lines[1]).toMatch(
      new RegExp(
        String.raw`^measure\s+${ENGINE_VERSION}\s+${ENGINE_VERSION}\s+verdict$`,
      ),
    );
    expect(lines.at(-1)).toBe("release check (tolerance 0): PASS");
  });

  it("offers a kit on some cases and none below the threshold, so coverage is measured", () => {
    const cases = seededCases();
    const candidate = { scorer: score, reads: SCORER_READS };
    const { coverage } = releaseCheck(score, candidate, cases, 0).comparison
      .metrics;

    expect(coverage.candidate).toBeGreaterThan(0);
    expect(coverage.candidate).toBeLessThan(1);
  });

  it("blocks a scorer that reads the air temperature without declaring it", () => {
    const candidate = { scorer: feelFromTemp, reads: SCORER_READS };
    const { comparison } = releaseCheck(score, candidate, seededCases(), 0);

    expect(comparison.blocked).toBe(
      "the candidate reads fields it does not declare: tempC",
    );
    expect(comparison.pass).toBe(false);
  });

  it("blocks one that declares the air temperature, on rebuilt cases alone", () => {
    const candidate = {
      scorer: feelFromTemp,
      reads: ["tempC", "precipMm"] as const,
    };
    const { comparison } = releaseCheck(score, candidate, seededCases(), 0);

    expect(
      RELEASE_METRICS.map((metric) => comparison.metrics[metric].verdict),
    ).toStrictEqual(["equal", "equal", "equal"]);
    expect(comparison.blocked).toBe(
      "the candidate reads tempC, which cases rebuilt from v1 history do not carry; replay it over logged Calls",
    );
    expect(comparison.pass).toBe(false);
  });
});
