import { describe, expect, it } from "vitest";

import type { Scorer } from "../../../src/modules/call/contract";
import {
  measure,
  noWorse,
  releaseCheck,
  replay,
  type ReplayCase,
} from "../../../src/modules/call/replay";
import { replayCase, request, result, scored } from "./fixtures";

const FORECAST = {
  kind: "forecast",
  tempC: 8,
  feelsLikeC: 6,
  precipMm: 0,
  windKph: 10,
} as const;

/**
 * A dialed run in a tee and shorts, asked about with a real forecast, so
 * the probe has fields to move.
 */
function aCase(overrides: Partial<ReplayCase> = {}): ReplayCase {
  return replayCase(["a-tee", "shorts"], 0, {
    request: request({ conditions: FORECAST }),
    ...overrides,
  });
}

/**
 * A run that was too cold in a tee alone. Any kit with a bottom is warmer,
 * so both versions below get its direction right and the measure is equal.
 */
function aColdRun(overrides: Partial<ReplayCase> = {}): ReplayCase {
  return replayCase(["a-tee"], -1, {
    caseId: "cold",
    request: request({ conditions: FORECAST }),
    ...overrides,
  });
}

const CASES = [aCase(), aColdRun()];
const LOGGED = [aCase({ origin: "logged" }), aColdRun({ origin: "logged" })];

/**
A scorer version that always answers with this kit.
*/
function wears(engineVersion: string, ...ids: string[]): Scorer {
  return () => ({ ...result(scored(...ids)), engineVersion });
}

const half = wears("v1", "a-tee", "tights");
const whole = wears("v2", "a-tee", "shorts");

/**
 * A version as good as `whole` that reads the air temperature: it drops
 * the kit when the probe moves the temperature far below freezing.
 */
const readsTemp: Scorer = (asked) => {
  const { conditions } = asked;
  const isFrozen = conditions.kind === "forecast" && conditions.tempC < -30;
  return isFrozen ? wears("v2")(asked) : whole(asked);
};

function declared(scorer: Scorer, ...reads: ("tempC" | "windKph")[]) {
  return { scorer, reads };
}

describe("releaseCheck", () => {
  it("replays both versions over the cases and compares their measures", () => {
    const check = releaseCheck(half, declared(whole), CASES, 0);
    const before = measure(replay(half, CASES));
    const after = measure(replay(whole, CASES));

    expect(check.comparison).toStrictEqual(
      noWorse(before, after, { tolerance: 0, reads: [], observed: [] }),
    );
    expect(check.comparison.metrics.dialedAgreement).toStrictEqual({
      metric: "dialedAgreement",
      baseline: 0.5,
      candidate: 1,
      verdict: "better",
    });
    expect(check.comparison.pass).toBe(true);
  });

  it("holds the candidate to the baseline, not the other way round", () => {
    const check = releaseCheck(whole, declared(half), CASES, 0);

    expect(check.comparison.metrics.dialedAgreement.verdict).toBe("worse");
    expect(check.comparison.pass).toBe(false);
  });

  it("heads the report's columns with each version, the baseline first", () => {
    const { report } = releaseCheck(half, declared(whole), CASES, 0);
    const lines = report.text.split("\n");

    expect(report.source).toBe("v1-history");
    expect(lines[0]).toBe("source: v1 history (rebuilt)");
    expect(lines[1]).toMatch(/^measure\s+v1\s+v2\s+verdict$/);
    expect(lines[4]).toMatch(
      /^dialed agreement\s+50\.0% \(1\/2\)\s+100\.0% \(2\/2\)\s+better$/,
    );
    expect(lines.at(-1)).toBe("release check (tolerance 0): PASS");
  });

  it("names the columns by their role when there is no case to read a version from", () => {
    const check = releaseCheck(half, declared(whole), [], 0);
    const lines = check.report.text.split("\n");

    expect(lines[1]).toMatch(/^measure\s+baseline\s+candidate\s+verdict$/);
    expect(check.comparison.metrics.coverage.verdict).toBe("unmeasured");
    expect(check.comparison.pass).toBe(false);
  });

  it("passes the tolerance on", () => {
    const lenient = releaseCheck(whole, declared(half), CASES, 0.5);

    expect(lenient.comparison).toMatchObject({
      tolerance: 0.5,
      pass: true,
      metrics: { dialedAgreement: { verdict: "within-tolerance" } },
    });
    expect(() => releaseCheck(whole, declared(half), CASES, -0.1)).toThrow(
      new RangeError("tolerance must not be negative: -0.1"),
    );
  });

  it("probes the candidate, and blocks a read it did not declare", () => {
    const check = releaseCheck(whole, declared(readsTemp), CASES, 0);

    expect(check.comparison.blocked).toBe(
      "the candidate reads fields it does not declare: tempC",
    );
    expect(check.comparison.pass).toBe(false);
    expect(check.report.text).toContain(
      "blocked: the candidate reads fields it does not declare: tempC",
    );
  });

  it("passes the declaration on: a declared temperature read is blocked on rebuilt cases alone", () => {
    const candidate = declared(readsTemp, "tempC");
    const rebuilt = releaseCheck(whole, candidate, CASES, 0);
    const logged = releaseCheck(whole, candidate, LOGGED, 0);

    expect(rebuilt.comparison.blocked).toBe(
      "the candidate reads tempC, which cases rebuilt from v1 history do not carry; replay it over logged Calls",
    );
    expect(rebuilt.comparison.pass).toBe(false);
    expect(logged.comparison.blocked).toBeUndefined();
    expect(logged.comparison.pass).toBe(true);
    expect(logged.report.source).toBe("logged-calls");
  });

  it("does not probe the baseline: what it reads has already shipped", () => {
    const check = releaseCheck(readsTemp, declared(whole), CASES, 0);

    expect(check.comparison.blocked).toBeUndefined();
    expect(check.comparison.pass).toBe(true);
  });
});
