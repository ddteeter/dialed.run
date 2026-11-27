import { describe, expect, it } from "vitest";

import type { CallRequest, Scorer } from "../../../src/modules/call/contract";
import {
  CONDITION_READS,
  observedReads,
  type ReplayCase,
} from "../../../src/modules/call/replay";
import { PROBE } from "../../../src/modules/call/replay/probe";
import { replayCase, request, result } from "./fixtures";

function forecastCase(
  overrides: Partial<CallRequest> = {},
  conditions: Partial<{
    tempC: number;
    feelsLikeC: number;
    precipMm: number;
    windKph: number;
  }> = {},
): ReplayCase {
  return replayCase([], 0, {
    request: request({
      conditions: {
        kind: "forecast",
        tempC: 8,
        feelsLikeC: 6,
        precipMm: 0,
        windKph: 10,
        ...conditions,
      },
      ...overrides,
    }),
  });
}

/**
 * A fake scorer whose answer shows the fields it was given, and nothing
 * else.
 */
function reading(...fields: (typeof CONDITION_READS)[number][]): Scorer {
  return (asked) => {
    const conditions = asked.conditions;
    const seen =
      conditions.kind === "forecast"
        ? fields.map((field) => String(conditions[field]))
        : [];
    return { ...result([]), engineVersion: seen.join("/") };
  };
}

const onlyLate: Scorer = (asked) =>
  asked.hourStart === 2 ? reading("tempC")(asked) : reading()(asked);

const showsConditions: Scorer = (asked) => ({
  ...result([]),
  engineVersion: JSON.stringify(asked.conditions),
});

describe("observedReads", () => {
  it("names each field a scorer reads, in the forecast's order", () => {
    const cases = [forecastCase()];
    expect(observedReads(reading("feelsLikeC"), cases)).toEqual(["feelsLikeC"]);
    expect(observedReads(reading("windKph", "tempC"), cases)).toEqual([
      "tempC",
      "windKph",
    ]);
    expect(observedReads(reading("precipMm"), cases)).toEqual(["precipMm"]);
    expect(
      observedReads(
        reading("precipMm", "feelsLikeC", "windKph", "tempC"),
        cases,
      ),
    ).toEqual(["tempC", "feelsLikeC", "precipMm", "windKph"]);
  });

  it("names nothing for a scorer that ignores the forecast", () => {
    expect(observedReads(reading(), [forecastCase()])).toEqual([]);
  });

  it("counts a field read on any one case", () => {
    const early = forecastCase({ hourStart: 1 });
    const late = forecastCase({ hourStart: 2 });
    expect(observedReads(onlyLate, [early])).toEqual([]);
    expect(observedReads(onlyLate, [early, late])).toEqual(["tempC"]);
    expect(observedReads(onlyLate, [late, early])).toEqual(["tempC"]);
  });

  it("does not probe a case with no forecast", () => {
    const noForecast = replayCase([], 0);
    expect(observedReads(showsConditions, [noForecast])).toEqual([]);
    expect(observedReads(showsConditions, [forecastCase()])).toEqual([
      ...CONDITION_READS,
    ]);
  });

  it("finds no read where the case already sits at the probe value", () => {
    const atProbe = forecastCase({}, { tempC: PROBE.tempC });
    expect(observedReads(reading("tempC"), [atProbe])).toEqual([]);
  });

  it("leaves the cases as they were", () => {
    const replayed = forecastCase();
    const before = structuredClone(replayed);
    observedReads(reading("tempC", "windKph"), [replayed]);
    expect(replayed).toEqual(before);
  });
});

describe("PROBE", () => {
  it("moves every forecast field, and only those", () => {
    expect(Object.keys(PROBE)).toEqual([...CONDITION_READS]);
    expect(PROBE).toEqual({
      tempC: -40,
      feelsLikeC: -40,
      precipMm: 50,
      windKph: 120,
    });
  });
});
